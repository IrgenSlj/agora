# agora — README hero demo
# Regenerate with:  bun run build && vhs scripts/demo.tape   →   docs/demo.gif
# (build first so dist/cli.js is executable on PATH).
#
# A curated three-beat story, all inside ONE persistent `agora` shell session
# so the branded prompt stays on screen the whole time:
#
#   1. DISCOVER   agora search mcp            — a real ranked catalog, in the terminal
#   2. INSTALL    agora install … --write     — scan + permission consent gate (the differentiator)
#   3. EXPLORE    agora tui                    — the full-screen, keyboard-driven marketplace
#
# Only the offline, curated surface is shown, so the GIF renders the same with
# or without a network. AGORA_HOME is a throwaway dir, so the session is always
# fresh (0 turns, no "Resumed…" banner).
#
# TIMING RULES (learned the hard way):
#   • The agora shell's line-reader drops an Enter that lands in the same beat
#     as the last typed character — so every command typed at the agora prompt
#     gets `Sleep 450ms` before its Enter. (TUI raw-mode keys are exempt.)
#   • `Wait` is only safe on TUI-internal text; gating a *shell* keystroke on
#     screen text fires before the reader is ready and eats input.

Output docs/demo.gif

Set Shell "bash"
Set FontSize 13
Set Width 1280
Set Height 800
Set Padding 16
Set Margin 24
Set MarginFill "#181825"
Set BorderRadius 12
Set WindowBar Colorful
Set TypingSpeed 38ms
Set Theme "Catppuccin Mocha"
Set WaitTimeout 20s

# ── Hidden setup: truecolor for the gradient banner, clean isolated state ──
Hide
Type "export COLORTERM=truecolor AGORA_HOME=$(mktemp -d)"
Enter
Type "clear"
Enter
Show
Sleep 500ms

# ═══════════════════════════════════════════════════════════════
# Cold open — the gradient AGORA banner
# ═══════════════════════════════════════════════════════════════
Type "agora"
Enter
Sleep 2400ms

# ═══════════════════════════════════════════════════════════════
# 1 — DISCOVER: a ranked marketplace, right in the terminal
# ═══════════════════════════════════════════════════════════════
Type "agora search mcp"
Sleep 450ms
Enter
Wait+Screen /results/
Sleep 3200ms

Hide
Type "clear"
Sleep 450ms
Enter
Show
Sleep 300ms

# ═══════════════════════════════════════════════════════════════
# 2 — INSTALL SAFELY: a scan + a permission consent gate
#     (`--write` refuses to apply until you explicitly grant access)
# ═══════════════════════════════════════════════════════════════
Type "agora install mcp-filesystem --write"
Sleep 450ms
Enter
Wait+Screen /grant and install/
Sleep 3600ms

Hide
Type "clear"
Sleep 450ms
Enter
Show
Sleep 300ms

# ═══════════════════════════════════════════════════════════════
# 3 — EXPLORE: the full-screen, keyboard-driven interface
# ═══════════════════════════════════════════════════════════════
# Runs as a fresh bash child — its own clean raw-mode session.
Type "agora tui"
Sleep 450ms
Enter
Wait+Screen /installs/
Sleep 900ms

# 1-5 switch pages (Tab cycles) — jump straight to the Marketplace
Type "2"
Wait+Screen /MARKETPLACE/
Sleep 1400ms

# Skim the catalog — note the dim [fs] / [net] / [exec] permission badges
Down
Sleep 350ms
Down
Sleep 350ms
Down
Sleep 900ms

# Enter opens a full detail card: stats, tags, repo, permissions, related items
Enter
Sleep 3000ms

# Quit the TUI, back to the branded shell
Escape
Sleep 400ms
Type "q"
Sleep 900ms

# ═══════════════════════════════════════════════════════════════
# Outro
# ═══════════════════════════════════════════════════════════════
Hide
Type "clear"
Sleep 450ms
Enter
Show
Sleep 300ms
# ASCII only — a multibyte char typed via VHS gets mangled by bash's echo.
Type "echo 'agora -- discover, install safely, and explore. npm i -g opencode-agora'"
Sleep 450ms
Enter
Sleep 2400ms
