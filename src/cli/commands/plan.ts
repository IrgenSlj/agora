import { ExitCode } from '../exit-codes.js';
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
 * Exit codes (brief §9): 0 ok (plan output communicates changes),
 * 1 policy forbid (gate blocked), 2 usage error.
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
      return ExitCode.POLICY_FORBID;
    }
  }

  const plan = await computePlan(args, io);
  const hasChanges = combinedHasChanges(plan);

  if (parsed.flags.json) {
    writeJson(io.stdout, { mode: 'plan', tools: plan.servers, instructions: plan.instructions });
    return ExitCode.OK;
  }

  writeLine(io.stdout, formatToolPlans('agora plan — MCP servers', plan.servers, theme));
  writeLine(io.stdout);
  writeLine(io.stdout, formatToolPlans('agora plan — instructions', plan.instructions, theme));
  writeLine(io.stdout);

  if (hasChanges) {
    writeLine(io.stdout, theme.muted('Changes pending. Run `agora apply` to reconcile.'));
  } else {
    writeLine(io.stdout, theme.muted('No changes. Stack matches agora.toml.'));
  }
  return ExitCode.OK;
};
