# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 2.x (unreleased; built on `main`) | yes |
| 0.8.x, the last published release | security fixes when practical |
| < 0.8 | no |

## Reporting a vulnerability

Do **not** open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/IrgenSlj/agora/security/advisories/new) with a
description, reproduction steps, affected commands and impact. Expect a response within 48 hours.

## Security model

Agora is local-first: no hosted backend, no account, nothing sent anywhere except lookups to
OSV.dev (`agora audit`, `agora ci`) and an optional fetch of the revocation list from this
repository.

- **The hook can only deny or stay silent.** It never emits `allow`, so it can never grant a
  permission the host would not have granted.
- **Hooks fail open; CI fails closed.** A hook error lets the call proceed and says so on stderr. A
  CI check that could not run is reported as not established, never as a pass.
- **No content capture.** Observation records tool names, counts and sampled network peers. It never
  stores tool arguments, results, prompt text or file contents.
- **The fetched revocation list can only add entries**, never remove one, so it needs no signing
  key to be safe to merge.
- **Host config writes are surgical and atomic** (`src/atomic-write.ts`) and preserve unrelated keys.

"No known advisories" or "nothing denied" means no known red flags, never "safe".

## Known limits

The open gaps are listed in [`docs/STATUS.md`](./docs/STATUS.md). Receipts written before signing
lands (phase 2) are self-reported and forgeable by an agent with shell access; the receipt states
its own signer level for that reason.
