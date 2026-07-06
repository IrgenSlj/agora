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
 * codes: 0 applied, 1 error, 3 scan-gate blocked (only reachable with
 * --from — nothing is written when the gate fails).
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
      return 3;
    }
  }

  let applied;
  try {
    applied = await computeApply(args, io);
  } catch (e) {
    writeLine(io.stderr, `Apply failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      mode: 'applied',
      tools: applied.servers,
      instructions: applied.instructions
    });
    return 0;
  }

  writeLine(io.stdout, formatToolPlans('agora apply — MCP servers', applied.servers, theme));
  writeLine(io.stdout);
  writeLine(io.stdout, formatToolPlans('agora apply — instructions', applied.instructions, theme));
  return 0;
};
