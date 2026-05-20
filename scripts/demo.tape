Output docs/demo.gif

Set Shell "bash"
Set FontSize 12
Set Width 1200
Set Height 720
Set Padding 12
Set TypingSpeed 30ms
Set Theme "Catppuccin Mocha"

# ═══════════════════════════════════════════════════════════════
# PART 1 — TUI exploration
# Each page is launched fresh from the shell for reliability.
# ═══════════════════════════════════════════════════════════════

# ── Cold open ──
Hide
Type "clear"
Enter
Show
Sleep 400ms

# ── Launch interactive shell ──
Type "agora"
Enter
Sleep 1500ms

# ────────────────────────────────────
# TUI: Marketplace
# ────────────────────────────────────
Type "/marketplace"
Enter
Sleep 1500ms

# Navigate to an item and open it
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 250ms
Enter
Sleep 2s

# Go back
Escape
Sleep 400ms

# Quit back to shell
Type "q"
Sleep 800ms

# ────────────────────────────────────
# TUI: News
# ────────────────────────────────────
Type "/news"
Enter
Sleep 1500ms

# Navigate to a story and open it
Down
Sleep 250ms
Down
Sleep 250ms
Enter
Sleep 1500ms

# AI preview
Type "p"
Sleep 3s

# Back to list
Escape
Sleep 400ms
Escape
Sleep 400ms

# Quit TUI
Type "q"
Sleep 800ms

# ═══════════════════════════════════════════════════════════════
# PART 2 — CLI commands
# ═══════════════════════════════════════════════════════════════

Hide
Type "clear"
Enter
Show
Sleep 300ms

# ── Daily digest ──
Type "agora today"
Enter
Sleep 3s

Hide
Type "clear"
Enter
Show
Sleep 200ms

# ── Marketplace search ──
Type "agora search mcp"
Enter
Sleep 2500ms

Hide
Type "clear"
Enter
Show
Sleep 200ms

# ── Pre-install safety scan ──
Type "agora scan mcp-github"
Enter
Sleep 2500ms

Hide
Type "clear"
Enter
Show
Sleep 200ms

# ── Install preview with declared permissions ──
Type "agora install mcp-github"
Enter
Sleep 2s

# ── Outro ──
Hide
Type "clear"
Enter
Show
Type "echo 'agora · the developer terminal hub'"
Enter
Sleep 1500ms
