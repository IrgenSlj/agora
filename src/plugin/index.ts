import type { Plugin } from '@opencode-ai/plugin';
import { createAgoraHooks } from './hooks.js';
import { createAgoraTools } from './tools.js';

export const Agora: Plugin = async (input, options) => {
  return {
    ...createAgoraHooks(input, options),
    tool: createAgoraTools(input)
  };
};

export default Agora;
