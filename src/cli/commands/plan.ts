import { writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import {
  combinedHasChanges,
  computePlan,
  formatGateBlocked,
  formatToolPlans,
  resolveStackArgs,
  runGate
} from './stack-shared.js';
import type { CommandHandler } from './types.js';

/**
 * `agora plan` — pure, read-only diff between agora.toml and the real config
 * files/instruction artifacts of every target tool. NEVER writes anything.
 * Exit codes (agent-operable contract, brief §6.3): 0 no changes pending,
 * 2 changes pending (run `agora apply`), 1 error, 3 scan-gate blocked
 * (only reachable with --from).
 */
export const commandPlan: CommandHandler = async (parsed, io, style) => {
  const theme = cliTheme(style, io);
  const resolved = await resolveStackArgs(parsed, io);
  if (!resolved.ok) return resolved.code;
  const args = resolved.value;

  if (args.fromFlag !== undefined) {
    const gate = await runGate(args, io);
    if (!gate.ok) {
      if (parsed.flags.json) {
        writeJson(io.stdout, { mode: 'gate-blocked', blocked: gate.blocked });
      } else {
        writeLine(io.stdout, formatGateBlocked(gate, theme));
      }
      return 3;
    }
  }

  const plan = await computePlan(args, io);
  const hasChanges = combinedHasChanges(plan);

  if (parsed.flags.json) {
    writeJson(io.stdout, { mode: 'plan', tools: plan.servers, instructions: plan.instructions });
    return hasChanges ? 2 : 0;
  }

  writeLine(io.stdout, formatToolPlans('agora plan — MCP servers', plan.servers, theme));
  writeLine(io.stdout);
  writeLine(io.stdout, formatToolPlans('agora plan — instructions', plan.instructions, theme));
  writeLine(io.stdout);

  if (hasChanges) {
    writeLine(io.stdout, theme.muted('Changes pending. Run `agora apply` to reconcile.'));
    return 2;
  }
  writeLine(io.stdout, theme.muted('No changes. Stack matches agora.toml.'));
  return 0;
};
