---
description: Search, browse, plan, and acquire MCP capabilities through Agora's federated catalog and trust gate
---

Route the first word of `$ARGUMENTS` to the matching Agora MCP tool, passing the rest of
`$ARGUMENTS` as that tool's arguments:

- `search <query>` → `agora_search`
- `browse <id>` → `agora_browse`
- `status` → `agora_stack_status`
- `plan` → `agora_plan`
- `acquire <id|query>` → `agora_acquire` — call it once with `confirm` omitted (a dry run: plan +
  gate verdict, nothing written), show the user the verdict, and only call it again with
  `confirm: true` after the user agrees to proceed. Never set `confirm: true` on the first call.

No argument, or anything else → call `agora_stack_status` to summarize the current stack.
