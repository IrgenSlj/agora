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
#   docs/demo.gif  (overwritten each run; not committed — see .gitignore)
#
# This tape walks the three pillars and the Phase 4 trust check in ~60 seconds.
# Keep it tight; viewers bail after 20 seconds. Edit ruthlessly.

Output docs/demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 720
Set Padding 18
Set TypingSpeed 60ms
Set Theme "Catppuccin Mocha"

# ── Cold open ──────────────────────────────────────────────────────────────
Hide
Type "clear"
Enter
Show

Sleep 700ms

# ── Welcome tour ───────────────────────────────────────────────────────────
Type "agora welcome"
Enter
Sleep 5s

Hide
Type "clear"
Enter
Show
Sleep 300ms

# ── Daily digest ───────────────────────────────────────────────────────────
Type "agora today"
Enter
Sleep 4s

Hide
Type "clear"
Enter
Show
Sleep 300ms

# ── Marketplace search ─────────────────────────────────────────────────────
Type "agora search mcp"
Enter
Sleep 4s

Hide
Type "clear"
Enter
Show
Sleep 300ms

# ── Phase 4 trust: scan before install ─────────────────────────────────────
Type "agora scan mcp-github"
Enter
Sleep 4s

Hide
Type "clear"
Enter
Show
Sleep 300ms

# ── Permission-gated install preview ───────────────────────────────────────
Type "agora install mcp-github"
Enter
Sleep 3500ms

Hide
Type "clear"
Enter
Show
Sleep 300ms

# ── Fade ────────────────────────────────────────────────────────────────────
Type "echo 'agora · the developer terminal hub'"
Enter
Sleep 1500ms
