#!/usr/bin/env bash
#
# Prove the thing that actually ships works.
#
#   bun run verify:package
#
# Everything else in this repository tests the source tree. Nobody installs the
# source tree. The gap between the two is not hypothetical here: v0.7.0's release
# fired, the publish step crashed, and npm stayed on 0.6.1 for weeks while the
# whole trust plane sat finished in `main`. A green test suite said nothing about
# it, because a green test suite was never looking at the tarball.
#
# So this packs the package, installs it into an empty directory the way a user
# would, and runs the commands that matter against the installed binary. It
# checks exit codes rather than output text: the exit contract is what CI and the
# GitHub Action depend on, and it is the part that breaks silently.
#
# Run it before publishing. CI runs it on every push.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d -t agora-verify-XXXXXX)"
FAILURES=0

cleanup() {
  rm -rf "$WORK"
  rm -f "$REPO"/agora-hub-*.tgz
}
trap cleanup EXIT

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# `agora <args>` from the installed package, in an isolated HOME so the run
# cannot read the developer's real host configs and report a false pass.
# stdin comes from /dev/null: `hook check` reads a payload from it, and an
# inherited terminal or an open pipe would make every one of these wait on the
# hook's stdin timeout instead of exiting immediately.
run_agora() {
  ( cd "$WORK/app" && HOME="$WORK/home" ./node_modules/.bin/agora "$@" </dev/null )
}

# expect <exit-code> <description> -- <args...>
expect() {
  local want="$1" desc="$2"
  shift 3  # want, desc, and the literal `--`
  local got=0
  run_agora "$@" >/dev/null 2>&1 || got=$?
  if [ "$got" -eq "$want" ]; then
    printf '  \033[32m✓\033[0m %s\n' "$desc"
  else
    printf '  \033[31m✗\033[0m %s — expected exit %s, got %s\n' "$desc" "$want" "$got"
    FAILURES=$((FAILURES + 1))
  fi
}

say "Building and packing"
cd "$REPO"
bun run build >/dev/null
TARBALL="$REPO/$(npm pack --silent)"
printf '  %s (%s bytes)\n' "$(basename "$TARBALL")" "$(wc -c < "$TARBALL" | tr -d ' ')"

say "Installing into a clean directory"
mkdir -p "$WORK/app" "$WORK/home"
cd "$WORK/app"
npm init -y >/dev/null 2>&1
npm install --silent --no-audit --no-fund "$TARBALL" >/dev/null
printf '  installed\n'

# The bin must exist and be executable. A missing `chmod +x` in the build script
# produces a package that installs perfectly and cannot be run.
if [ ! -x "$WORK/app/node_modules/.bin/agora" ]; then
  printf '  \033[31m✗\033[0m node_modules/.bin/agora is missing or not executable\n'
  exit 1
fi

say "Smoke tests against the installed binary"

expect 0 "agora --version" -- --version
expect 0 "agora --help" -- --help
expect 0 "agora doctor (no servers configured)" -- doctor
expect 0 "agora audit (no servers configured)" -- audit
expect 0 "agora installed" -- installed
expect 0 "agora search (network, degrades to cache)" -- search filesystem
expect 0 "agora policy check (bundled baseline loads)" -- policy check

# The CI wedge. `uses: IrgenSlj/agora@v0` runs exactly this, so a break here
# breaks the surface the product is being pointed at.
expect 0 "agora ci (nothing established, nothing failed)" -- ci
expect 1 "agora ci --fail-on-unknown (absence is a failure)" -- ci --fail-on-unknown
expect 0 "agora ci --json" -- ci --json

# The exit-code contract the Action and any script depend on.
expect 2 "unknown command exits USAGE" -- definitely-not-a-command
expect 2 "agora lock verify with no lockfile exits USAGE" -- lock verify
expect 0 "agora lock write --no-fetch (no baseline: pins nothing, still succeeds)" -- lock write --no-fetch

# The hook is the enforcement surface and runs before every MCP tool call, so
# its contract matters more than most: it must exit 0 on a payload it cannot
# use rather than blocking the agent, and `hook install --dry-run` must not
# write. Both are asserted against the installed binary because the fast path
# in cli.ts bypasses the CLI entirely and would not be exercised otherwise.
expect 0 "agora hook check (no payload on stdin)" -- hook check
expect 0 "agora hook install --dry-run" -- hook install --dry-run
expect 2 "agora hook with no subcommand exits USAGE" -- hook

# The decision path, against the installed binary. A hook that blocks on its own
# failure is worse than no hook at all, so the assertion is that a payload for a
# server it has never heard of still exits 0 and prints nothing on stdout.
hook_out="$(printf '%s' '{"tool_name":"mcp__nothing__x","cwd":"'"$WORK/app"'"}' \
  | ( cd "$WORK/app" && HOME="$WORK/home" ./node_modules/.bin/agora hook check ) 2>/dev/null)"
if [ -z "$hook_out" ]; then
  printf '  \033[32m✓\033[0m hook check on an unknown server decides nothing\n'
else
  printf '  \033[31m✗\033[0m hook check printed a decision it should not have: %s\n' "$hook_out"
  FAILURES=$((FAILURES + 1))
fi

# Acquire's dry run resolves federation, runs the scan, and evaluates policy
# without writing. It is also the path that imports package.json from dist/,
# which resolves differently in a published layout than in the repo.
expect 0 "agora acquire --dry-run" -- acquire mcp-filesystem --dry-run

say "Schemas ship with the package"
for schema in lockfile.v1.json artifact-lock-entry.v1.json revocation-feed.v1.json; do
  if [ -f "$WORK/app/node_modules/agora-hub/schemas/$schema" ]; then
    printf '  \033[32m✓\033[0m %s\n' "$schema"
  else
    printf '  \033[31m✗\033[0m %s missing from the package\n' "$schema"
    FAILURES=$((FAILURES + 1))
  fi
done

say "Revocation feed is bundled and parses"
FEED="$WORK/app/node_modules/agora-hub/dist/revocations.json"
if node -e "
  const f = require('$FEED');
  if (!Array.isArray(f.entries)) throw new Error('no entries array');
  if (!f.generated_at) throw new Error('no generated_at');
  console.log('  entries: ' + f.entries.length + ', generated ' + f.generated_at);
" 2>/dev/null; then
  printf '  \033[32m✓\033[0m feed present and well-formed\n'
else
  printf '  \033[31m✗\033[0m bundled revocation feed missing or malformed\n'
  FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -gt 0 ]; then
  printf '\n\033[31m%s check(s) failed against the packed artifact.\033[0m\n' "$FAILURES"
  printf 'Do not publish. The source tree passing says nothing about this.\n'
  exit 1
fi

printf '\n\033[32mThe packed artifact installs and runs.\033[0m\n'
printf 'This proves the tarball works — not that the release is correct.\n'
