# scripts/demo.tape — VHS recording for the README hero gif
#
# Prereqs:
#   1. Install VHS:  brew install vhs  (or see https://github.com/charmbracelet/vhs)
#   2. Install agora globally:  npm i -g opencode-agora
#   3. (optional) export AGORA_GITHUB_TOKEN=... so live-hub checks don't rate-limit
#
# Generate:
#   vhs scripts/demo.tape
#
# Output:
#   docs/demo.gif  (overwritten each run)

Output docs/demo.gif

Set Shell "bash"
Set FontSize 12
Set Width 1200
Set Height 720
Set Padding 12
Set TypingSpeed 30ms
Set Theme "Catppuccin Mocha"

# ── Cold open ──
Hide
Type "clear"
Enter
Show
Sleep 300ms

# ── Launch the agora interactive shell ──
Type "agora"
Enter
Sleep 1s

# ── TUI: Home page ──
Type "/home"
Enter
Sleep 1200ms

# ── TUI: Marketplace (page 2) — browse and inspect an item ──
Type "2"
Sleep 400ms

Down
Sleep 120ms
Down
Sleep 120ms
Down
Sleep 120ms
Enter
Sleep 1200ms
Escape
Sleep 300ms

# ── TUI: News (page 4) — open an article and preview ──
Type "4"
Sleep 400ms

Down
Sleep 120ms
Down
Sleep 120ms
Enter
Sleep 1s
Type "p"
Sleep 2s
Escape
Sleep 300ms
Escape
Sleep 300ms

# ── Back to shell for CLI commands ──
Type "q"
Sleep 400ms

# ── CLI: daily digest ──
Hide
Type "clear"
Enter
Show
Sleep 200ms
Type "agora today"
Enter
Sleep 2s

Hide
Type "clear"
Enter
Show
Sleep 200ms

# ── CLI: marketplace search ──
Type "agora search mcp"
Enter
Sleep 2s

Hide
Type "clear"
Enter
Show
Sleep 200ms

# ── CLI: safety scan before install ──
Type "agora scan mcp-github"
Enter
Sleep 2s

Hide
Type "clear"
Enter
Show
Sleep 200ms

# ── CLI: install preview with declared permissions ──
Type "agora install mcp-github"
Enter
Sleep 1500ms

# ── Fade ──
Hide
Type "clear"
Enter
Show
Type "echo 'agora · the developer terminal hub'"
Enter
Sleep 1s
