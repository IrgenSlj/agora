import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TranscriptEntry {
  ts: string;
  kind: 'bash' | 'chat-user' | 'chat-assistant' | 'meta';
  input?: string;
  output?: string;
  exitCode?: number;
}

export interface SessionMeta {
  sessionId: string | null;
  cwd: string;
  createdAt: string;
  lastUsedAt: string;
  turnCount: number;
}

export function cwdHash(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

function transcriptDir(dataDir: string): string {
  const dir = join(dataDir, 'transcripts');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getTranscriptPath(dataDir: string, cwd: string): string {
  return join(transcriptDir(dataDir), `${cwdHash(cwd)}.jsonl`);
}

export function getSessionMetaPath(dataDir: string, cwd: string): string {
  return join(transcriptDir(dataDir), `${cwdHash(cwd)}.session.json`);
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}

export function appendTranscript(dataDir: string, cwd: string, entry: TranscriptEntry): void {
  const path = getTranscriptPath(dataDir, cwd);
  const line = JSON.stringify(entry) + '\n';
  // append-write: not atomic for append, but safe enough for JSONL
  writeFileSync(path, line, { flag: 'a', encoding: 'utf8' });
}

export function readTranscript(
  dataDir: string,
  cwd: string,
  opts: { tail?: number } = {}
): TranscriptEntry[] {
  const path = getTranscriptPath(dataDir, cwd);
  if (!existsSync(path)) return [];

  const raw = readFileSync(path, 'utf8');
  const entries: TranscriptEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as TranscriptEntry);
    } catch {
      // skip malformed lines
    }
  }

  if (opts.tail !== undefined && entries.length > opts.tail) {
    return entries.slice(entries.length - opts.tail);
  }
  return entries;
}

export function loadSessionMeta(dataDir: string, cwd: string): SessionMeta | undefined {
  const path = getSessionMetaPath(dataDir, cwd);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SessionMeta;
  } catch {
    return undefined;
  }
}

export function writeSessionMeta(dataDir: string, cwd: string, meta: SessionMeta): void {
  const path = getSessionMetaPath(dataDir, cwd);
  atomicWrite(path, JSON.stringify(meta, null, 2) + '\n');
}

export function recentBashContext(
  dataDir: string,
  cwd: string,
  opts: { commands: number; lines: number }
): string {
  const entries = readTranscript(dataDir, cwd);
  const bashEntries = entries.filter((e) => e.kind === 'bash').slice(-opts.commands);
  if (bashEntries.length === 0) return '';

  const sections = bashEntries.map((entry) => {
    const cmd = entry.input ?? '';
    const output = entry.output ?? '';
    const lastLines = output.split('\n').slice(-opts.lines).join('\n');
    return `─── $ ${cmd} ───\n${lastLines}`;
  });

  return `Recent shell output in this session:\n${sections.join('\n')}`;
}
