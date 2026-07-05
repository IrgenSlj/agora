import type {
  SourceResult,
  SourceOptions,
  TutorialSourceOptions,
  FindTutorialSourceOptions,
  Tutorial
} from './types.js';
import {
  requestJson,
  normalizeTutorialLevel,
  normalizeLimit,
  mapTutorial,
  findTutorialInList,
  api,
  offline
} from './internal.js';
import { getTutorials, findTutorial } from '../marketplace.js';

function shouldUseApi(options: SourceOptions): boolean {
  return Boolean(options.useApi && options.apiUrl);
}

async function tutorialsApi(options: TutorialSourceOptions): Promise<Tutorial[]> {
  const payload = await requestJson<{ tutorials?: Record<string, unknown>[] }>(
    options,
    '/api/tutorials'
  );
  const query = (options.query || '').trim().toLowerCase();
  const level = normalizeTutorialLevel(options.level || 'all');
  const limit = normalizeLimit(options.limit);
  const tutorials = (payload.tutorials || [])
    .map(mapTutorial)
    .filter((tutorial) => level === 'all' || tutorial.level === level)
    .filter((tutorial) => {
      if (!query) return true;
      return `${tutorial.id} ${tutorial.title} ${tutorial.description} ${tutorial.level}`
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  return limit ? tutorials.slice(0, limit) : tutorials;
}

export async function tutorialsSource(
  options: TutorialSourceOptions = {}
): Promise<SourceResult<Tutorial[]>> {
  if (!shouldUseApi(options)) {
    return offline(getTutorials(options));
  }

  try {
    const data = await tutorialsApi(options);
    return api(data, options);
  } catch (error) {
    return offline(getTutorials(options), error);
  }
}

export async function findTutorialSource(
  options: FindTutorialSourceOptions
): Promise<SourceResult<Tutorial | null>> {
  if (!shouldUseApi(options)) {
    return offline(findTutorial(options.id));
  }

  try {
    const tutorials = await tutorialsApi(options);
    return api(findTutorialInList(tutorials, options.id), options);
  } catch (error) {
    return offline(findTutorial(options.id), error);
  }
}
