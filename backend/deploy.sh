#!/usr/bin/env bash
#
# Agora backend — one-command deploy to Cloudflare Workers + D1.
#
# Walks a first-time deploy end to end: login, create the D1 database, wire its
# id into wrangler.toml, apply the schema, set the required secrets, and deploy.
# Safe to re-run — each step detects whether it has already been done.
#
# Prerequisites you provide:
#   - a Cloudflare account (free tier is fine)
#   - a GitHub OAuth app (https://github.com/settings/developers → New OAuth App)
#     with callback URL  https://<your-worker-domain>/api/auth/github/callback
#
# Usage:  cd backend && ./deploy.sh
#
set -euo pipefail

cd "$(dirname "$0")"

WRANGLER="npx --yes wrangler"
TOML="wrangler.toml"
DB_NAME="agora"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  \033[2m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

bold "Agora backend deploy"
echo

# ── 1. Tooling ───────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "node is required (it ships npx, which runs wrangler). Install Node 18+ and re-run." >&2
  exit 1
fi

# ── 2. Cloudflare login ──────────────────────────────────────────────────────
bold "1/5 Cloudflare login"
if $WRANGLER whoami >/dev/null 2>&1; then
  ok "already logged in"
else
  info "opening your browser to authorize wrangler…"
  $WRANGLER login
  ok "logged in"
fi
echo

# ── 3. D1 database ───────────────────────────────────────────────────────────
bold "2/5 D1 database '$DB_NAME'"
DB_ID=""
# Try to create; if it already exists, look it up instead.
CREATE_OUT="$($WRANGLER d1 create "$DB_NAME" 2>&1 || true)"
DB_ID="$(printf '%s' "$CREATE_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)"
if [ -z "$DB_ID" ]; then
  info "database may already exist — looking it up…"
  INFO_OUT="$($WRANGLER d1 info "$DB_NAME" 2>&1 || true)"
  DB_ID="$(printf '%s' "$INFO_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)"
fi
if [ -z "$DB_ID" ]; then
  warn "couldn't determine the database id automatically."
  printf "  Paste the database_id from the Cloudflare dashboard (D1): "
  read -r DB_ID
fi
[ -n "$DB_ID" ] || { echo "No database id — aborting." >&2; exit 1; }
ok "database id: $DB_ID"

# Wire it into wrangler.toml (only replaces the placeholder; leaves a real id be).
if grep -q 'your-database-id-here' "$TOML"; then
  # portable in-place sed (BSD/macOS + GNU)
  sed -i.bak "s/your-database-id-here/$DB_ID/" "$TOML" && rm -f "$TOML.bak"
  ok "wrote database_id into $TOML"
else
  info "$TOML already has a database_id — leaving it untouched"
fi
echo

# ── 4. Schema ────────────────────────────────────────────────────────────────
bold "3/5 Apply schema to the remote database"
$WRANGLER d1 execute "$DB_NAME" --remote --file=schema.sql
ok "schema applied"
echo

# ── 5. Secrets ───────────────────────────────────────────────────────────────
bold "4/5 Secrets"
set_secret() { # name, value
  printf '%s' "$2" | $WRANGLER secret put "$1" >/dev/null
  ok "set $1"
}
prompt_secret() { # name, prompt-text  → echoes value
  local val=""
  printf "  %s: " "$2" >&2
  read -rs val; echo >&2
  printf '%s' "$val"
}

# AUTH_SECRET — auto-generate if the user just hits enter.
printf "  AUTH_SECRET (JWT signing key; press Enter to auto-generate): " >&2
read -rs AUTH_SECRET; echo >&2
if [ -z "$AUTH_SECRET" ]; then
  if command -v openssl >/dev/null 2>&1; then
    AUTH_SECRET="$(openssl rand -hex 32)"
    info "generated a random 256-bit AUTH_SECRET"
  else
    AUTH_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
    info "generated a random 256-bit AUTH_SECRET"
  fi
fi
set_secret AUTH_SECRET "$AUTH_SECRET"

GH_ID="$(prompt_secret GITHUB_CLIENT_ID 'GITHUB_CLIENT_ID (from your GitHub OAuth app)')"
set_secret GITHUB_CLIENT_ID "$GH_ID"
GH_SECRET="$(prompt_secret GITHUB_CLIENT_SECRET 'GITHUB_CLIENT_SECRET')"
set_secret GITHUB_CLIENT_SECRET "$GH_SECRET"

printf "  AGORA_ADMIN_USER_IDS (optional, comma-separated GitHub user ids; Enter to skip): " >&2
read -r ADMIN_IDS;
if [ -n "$ADMIN_IDS" ]; then set_secret AGORA_ADMIN_USER_IDS "$ADMIN_IDS"; else info "skipped (no admins)"; fi
echo

# ── 6. Deploy ────────────────────────────────────────────────────────────────
bold "5/5 Deploy"
$WRANGLER deploy
echo
bold "Done."
info "Point the CLI at it with:  agora auth login --api-url https://<your-worker-url>"
info "Verify reachability:        agora ping --api-url https://<your-worker-url>"
