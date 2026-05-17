import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LocalPreferences {
  theme: 'dark' | 'light' | 'auto';
  verbosity: 'verbose' | 'medium' | 'quiet';
  defaultNewsSource: string;
  defaultNewsCategory: string;
  username: string;
  email: string;
  bio: string;
  lastTab: number;
}

const DEFAULTS: LocalPreferences = {
  theme: 'dark',
  verbosity: 'medium',
  defaultNewsSource: 'all',
  defaultNewsCategory: 'all',
  username: '',
  email: '',
  bio: '',
  lastTab: 0
};

export function prefsPath(dataDir: string): string {
  return join(dataDir, 'preferences.json');
}

export function loadPreferences(dataDir: string): LocalPreferences {
  const path = prefsPath(dataDir);
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writePreferences(dataDir: string, prefs: LocalPreferences): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(prefsPath(dataDir), JSON.stringify(prefs, null, 2), 'utf8');
}
