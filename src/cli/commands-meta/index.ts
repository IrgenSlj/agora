import { COMMANDS as CatalogCommands } from './catalog.js';
import { COMMANDS as SetupCommands } from './setup.js';
import { COMMANDS as LibraryCommands } from './library.js';
import { COMMANDS as LearnCommands } from './learn.js';
import { COMMANDS as StackCommands } from './stack.js';

export type { CommandGroup, CommandMeta } from './types.js';
export { renderManual } from './types.js';

export const COMMANDS = [
  ...CatalogCommands,
  ...SetupCommands,
  ...LibraryCommands,
  ...LearnCommands,
  ...StackCommands
];
