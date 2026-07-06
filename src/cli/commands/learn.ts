import { findTutorialSource, tutorialsSource } from '../../live.js';
import { formatTutorialList, formatTutorialStep, header } from '../format.js';
import {
  numberFlag,
  sourceLabel,
  sourceOptions,
  sourcePayload,
  tutorialLevelFlag,
  tutorialStepNumber,
  tutorialStepPayload,
  usageError,
  warnFallback,
  writeJson,
  writeLine
} from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export const commandTutorials: CommandHandler = async (parsed, io, style) => {
  const query = parsed.args.join(' ');
  const level = tutorialLevelFlag(parsed);
  if (!level.ok) return usageError(io, level.error);

  const limit = numberFlag(parsed, 'limit', 'n') || 20;
  const result = await tutorialsSource({
    ...(await sourceOptions(parsed, io)),
    query,
    level: level.value,
    limit
  });
  const tutorials = result.data;
  warnFallback(result, io);

  if (parsed.flags.json) {
    writeJson(
      io.stdout,
      sourcePayload(result, { query, level: level.value, count: tutorials.length, tutorials })
    );
    return 0;
  }

  if (tutorials.length === 0) {
    writeLine(io.stdout, query ? `No tutorials match "${query}".` : 'No tutorials found.');
    return 0;
  }

  const theme = cliTheme(style, io);
  writeLine(
    io.stdout,
    header('agora tutorials', [`${tutorials.length} results`, sourceLabel(result)], theme)
  );
  writeLine(io.stdout, '');
  writeLine(io.stdout, formatTutorialList(tutorials, theme));
  return 0;
};

export const commandTutorial: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) {
    const { sampleTutorials } = await import('../../data.js');
    const theme = cliTheme(style, io);
    writeLine(
      io.stdout,
      header('agora tutorial', [`${sampleTutorials.length} available tutorials`], theme)
    );
    writeLine(io.stdout, '');
    writeLine(
      io.stdout,
      sampleTutorials
        .map(
          (t) =>
            `  ${style.accent(t.id.padEnd(22))} ${style.dim(t.title)} ${style.dim('[' + t.level + ']')}`
        )
        .join('\n')
    );
    writeLine(io.stdout, '');
    writeLine(io.stdout, style.dim('Run `agora tutorial <id>` to start a tutorial.'));
    return 0;
  }

  const step = tutorialStepNumber(parsed);
  if (!step.ok) return usageError(io, step.error);

  const result = await findTutorialSource({ ...(await sourceOptions(parsed, io)), id });
  const tutorial = result.data;
  warnFallback(result, io);
  if (!tutorial) return usageError(io, `Tutorial not found: ${id}`);

  if (parsed.flags.json) {
    writeJson(
      io.stdout,
      sourcePayload(result, {
        tutorial,
        step: tutorialStepPayload(tutorial, step.value)
      })
    );
    return 0;
  }

  const theme = cliTheme(style, io);
  writeLine(io.stdout, formatTutorialStep(tutorial, step.value, theme));
  return 0;
};
