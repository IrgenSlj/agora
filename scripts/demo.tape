# agora — README hero demo
# Regenerate with:  vhs scripts/demo.tape   →   docs/demo.gif
# (run `bun run build` first so dist/cli.js is executable on PATH).
#
# The whole demo runs inside ONE persistent `agora` shell session, so the
# branded prompt stays on screen throughout. Only the offline, curated,
# fully-deterministic surface is shown (marketplace + CLI), so the GIF renders
# the same with or without network.
#
# TIMING RULES learned the hard way:
#   • The agora shell's line-reader drops an Enter that lands in the same beat
#     as the last typed character — so every command typed at the agora prompt
#     gets `Sleep 450ms` before its Enter.
#   • `Wait` is only safe on TUI-internal text (raw mode); gating a *shell*
#     keystroke on screen text fires before the reader is ready and eats input.

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
# 1 — Cold open: the gradient AGORA banner (launched from bash)
# ═══════════════════════════════════════════════════════════════
Type "agora"
Enter
Sleep 2200ms

# ═══════════════════════════════════════════════════════════════
# 2 — It's a real shell: bash dispatch ($›) lives next to the hub
# ═══════════════════════════════════════════════════════════════
Type "ls"
Sleep 450ms
Enter
Sleep 1800ms

# ═══════════════════════════════════════════════════════════════
# 3 — Marketplace TUI: 5 pages, details, install-consent gate
# ═══════════════════════════════════════════════════════════════
# `agora tui` runs as a fresh bash child — its own clean raw-mode session.
Type "agora tui"
Sleep 450ms
Enter
Wait+Screen /installs/
Sleep 1200ms

# 1-5 switch pages (Tab cycles) — jump to the Marketplace
Type "2"
Wait+Screen /MARKETPLACE/
Sleep 1300ms

# Skim down to a server that declares permissions (dim [net] badge)
Down
Sleep 300ms
Down
Sleep 300ms
Down
Sleep 1000ms

# Enter opens full details: stats, tags, repo, permissions, related items
Enter
Sleep 2600ms
Escape
Sleep 600ms

# `i` previews the install — the footer flips to a permissions GRANT gate,
# the consent step that sets agora apart.
Type "i"
Wait+Screen /grant/
Sleep 2900ms
Escape
Sleep 600ms

# Quit the TUI, back to the branded shell
Type "q"
Sleep 1000ms

# ═══════════════════════════════════════════════════════════════
# 4 — Scriptable CLI: search, safety scan, consented install
# ═══════════════════════════════════════════════════════════════
Hide
Type "clear"
Sleep 450ms
Enter
Show
Sleep 400ms

# Curated + live search — every command also speaks --json
Type "agora search mcp"
Sleep 450ms
Enter
Wait+Screen /results/
Sleep 3000ms

Hide
Type "clear"
Sleep 450ms
Enter
Show
Sleep 300ms

# Pre-install safety scan: repo reachable, npm exists, flag count, perms
Type "agora scan mcp-filesystem"
Sleep 450ms
Enter
Wait+Screen /pass/
Sleep 3000ms

Hide
Type "clear"
Sleep 450ms
Enter
Show
Sleep 300ms

# `--write` refuses to apply until permissions are explicitly granted
Type "agora install mcp-filesystem --write"
Sleep 450ms
Enter
Wait+Screen /grant and install/
Sleep 3200ms

# ═══════════════════════════════════════════════════════════════
# 5 — Outro
# ═══════════════════════════════════════════════════════════════
Hide
Type "clear"
Sleep 450ms
Enter
Show
Sleep 300ms
# ASCII only — a multibyte char typed via VHS gets mangled by bash's echo
# (the agora binary prints UTF-8 fine; this is a typed-literal limitation).
Type "echo 'agora -- discover, vet, and install. npm i -g opencode-agora'"
Sleep 450ms
Enter
Sleep 2200ms
