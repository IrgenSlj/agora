#!/usr/bin/env bash
# Seeds the throwaway sandbox that scripts/demo.tape records against.
#
#   bun run build && bash scripts/demo-sandbox.sh && vhs scripts/demo.tape
#
# The tape points HOME/XDG_CONFIG_HOME/AGORA_HOME at this sandbox, so the
# recording can never read or write the recorder's real agent configs.
# Re-running resets it to a known state.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Deliberately a short, neutral path: it appears on screen in the recording
# (e.g. `agora freeze --write` echoes its target), and a repo-relative sandbox
# leaked the recorder's home directory into the frame.
SB="/tmp/agora-demo"

rm -rf "$SB"
mkdir -p "$SB/.config/opencode" "$SB/bin"

# A plausible starting stack: three servers already configured in OpenCode.
cat > "$SB/.config/opencode/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "@modelcontextprotocol/server-filesystem"],
      "enabled": true
    },
    "github": {
      "type": "local",
      "command": ["npx", "@modelcontextprotocol/server-github"],
      "enabled": true
    },
    "postgres": {
      "type": "local",
      "command": ["npx", "@modelcontextprotocol/server-postgres"],
      "enabled": true
    }
  }
}
JSON

# `agora` on PATH, pointing at the freshly built dist.
cat > "$SB/bin/agora" <<EOF
#!/usr/bin/env bash
exec node "$ROOT/dist/cli.js" "\$@"
EOF
chmod +x "$SB/bin/agora"

if [ ! -f "$ROOT/dist/cli.js" ]; then
  echo "dist/cli.js missing — run 'bun run build' first." >&2
  exit 1
fi

echo "sandbox ready: $SB"
echo "add to PATH when recording: export PATH=\"$SB/bin:\$PATH\""
