# agora — README hero demo
#
# Regenerate with:  bun run build && bun scripts/demo-sandbox.sh && vhs scripts/demo.tape
# Output: docs/assets/demo.gif
#
# A four-beat trust-plane story, in the order the product itself works:
#
#   1. AUDIT    agora doctor            — every MCP server across every host
#   2. FEDERATE agora search postgres   — one search over multi-source registries
#   3. GATE     agora scan mcp-postgres — the customs office, verdict and all
#   4. MANAGE   agora freeze --write    — the portable, committable profile
#
# Everything runs against a throwaway sandbox HOME seeded by
# scripts/demo-sandbox.sh, so the recording never touches the recorder's real
# agent configs. Beats 2 and 3 do hit the network (live registry search, and
# the scan's GitHub/npm checks) — that is the point, so the frames show real
# upstream data rather than a mock, and the exact rows will differ per take.
#
# TIMING NOTE: these are plain bash commands, not the agora shell, so the
# Enter-swallowing workaround the old tape needed no longer applies. Beats are
# gated on `Wait+Screen` where output is stable, with a fixed Sleep after so
# the viewer can actually read the frame.

Output docs/assets/demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 700
Set Padding 18
Set Margin 26
Set MarginFill "#1A1614"
Set BorderRadius 12
Set WindowBar Colorful
Set TypingSpeed 42ms
Set Theme "Catppuccin Mocha"
Set WaitTimeout 25s

# ── Hidden setup: sandbox env, truecolor, clean prompt ─────────────────────
Hide
Type "export SB=/tmp/agora-demo"
Enter
Type "export PATH=$SB/bin:$PATH"
Enter
Type "export HOME=$SB XDG_CONFIG_HOME=$SB/.config AGORA_HOME=$SB/agora COLORTERM=truecolor"
Enter
Type "export PS1=$'\\033[38;2;198;106;74m\\342\\235\\257\\033[0m '"
Enter
Type "cd $SB"
Enter
Type "clear"
Enter
Show
Sleep 800ms

# ═══════════════════════════════════════════════════════════════
# 1 — AUDIT: what is already running inside your agents?
# ═══════════════════════════════════════════════════════════════
Type "agora doctor"
Enter
Wait+Screen /ok:/
Sleep 2600ms

Hide
Type "clear"
Enter
Show
Sleep 300ms

# ═══════════════════════════════════════════════════════════════
# 2 — FEDERATE: one search across upstream registries
# ═══════════════════════════════════════════════════════════════
Type "agora search postgres --limit 4"
Enter
Wait+Screen /results/
Sleep 3400ms

Hide
Type "clear"
Enter
Show
Sleep 300ms

# ═══════════════════════════════════════════════════════════════
# 3 — GATE: the customs office. Note it reports warnings honestly
#     rather than stamping the package "safe".
# ═══════════════════════════════════════════════════════════════
Type "agora scan mcp-postgres"
Enter
Wait+Screen /pass/
Sleep 4200ms

Hide
Type "clear"
Enter
Show
Sleep 300ms

# ═══════════════════════════════════════════════════════════════
# 4 — MANAGE: freeze the whole stack into a portable profile
# ═══════════════════════════════════════════════════════════════
Type "agora freeze --write"
Enter
Wait+Screen /Written to/
Sleep 1400ms

Type "cat agora.toml"
Enter
Sleep 3600ms

# ═══════════════════════════════════════════════════════════════
# Outro
# ═══════════════════════════════════════════════════════════════
Hide
Type "clear"
Enter
Show
Sleep 300ms
# ASCII only — VHS mangles multibyte chars typed through bash echo.
Type "echo 'agora -- the trust plane for agentic tooling. npm i -g agora-hub'"
Enter
Sleep 3000ms
