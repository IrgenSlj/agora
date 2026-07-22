import { ExitCode } from '../exit-codes.js';
import { writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import {
  computeApply,
  formatGateBlocked,
  formatToolPlans,
  resolveStackArgs,
  runGate
} from './stack-shared.js';
import type { CommandHandler } from './types.js';

/**
 * `agora apply` — executes the plan: reconciles agora.toml's MCP servers and
 * instruction artifacts into every target tool's real config/files. Exit
 * codes (brief §9): 0 ok (applied), 1 policy forbid (gate blocked) / error,
 * 2 usage error.
 */
export const commandApply: CommandHandler = async (parsed, io, style) => {
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

  let applied;
  try {
    applied = await computeApply(args, io);
  } catch (e) {
    writeLine(io.stderr, `Apply failed: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.POLICY_FORBID;
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      mode: 'applied',
      tools: applied.servers,
      instructions: applied.instructions
    });
    return ExitCode.OK;
  }

  writeLine(io.stdout, formatToolPlans('agora apply — MCP servers', applied.servers, theme));
  writeLine(io.stdout);
  writeLine(io.stdout, formatToolPlans('agora apply — instructions', applied.instructions, theme));
  return ExitCode.OK;
};
