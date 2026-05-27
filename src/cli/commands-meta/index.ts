import { COMMANDS as MarketplaceCommands } from './marketplace.js';
import { COMMANDS as SetupCommands } from './setup.js';
import { COMMANDS as LibraryCommands } from './library.js';
import { COMMANDS as LearnCommands } from './learn.js';
import { COMMANDS as CommunityCommands } from './community.js';
import { COMMANDS as StackCommands } from './stack.js';

export type { CommandGroup, CommandMeta } from './types.js';
export { renderManual } from './types.js';

export const COMMANDS = [
  ...MarketplaceCommands,
  ...SetupCommands,
  ...LibraryCommands,
  ...LearnCommands,
  ...CommunityCommands,
  ...StackCommands,
];
