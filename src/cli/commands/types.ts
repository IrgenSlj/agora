import type { Styler } from '../../ui.js';
import type { CliIo, ParsedArgs } from '../flags.js';

export type CommandHandler = (parsed: ParsedArgs, io: CliIo, style: Styler) => Promise<number>;

export type CommandMap = Record<string, CommandHandler>;
