import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { atomicWriteFile } from '../atomic-write.js';
import { searchGithub } from '../hubs/github.js';
import { searchHuggingFace } from '../hubs/huggingface.js';
import { fetchRepoMetadata, fetchHfRepoMetadata } from '../hubs/enrichment.js';
import type { HubItem } from '../hubs/types.js';
import { FREE_MODELS } from '../cli/commands/chat.js';

const MAX_AI_ITEMS = 50;
const MAX_RETRIES = 3;

export interface CuratedPackage {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: 'mcp' | 'prompt' | 'workflow' | 'skill';
  tags: string[];
  stars: number;
  installs: number;
  repository: string;
  npmPackage?: string;
  createdAt: string;
  pricing: { kind: 'free' };
  permissions?: { fs?: string[]; net?: string[]; exec?: string[] };
  installHint?: string;
  aiVerifiedAt: string;
}

export function curationCachePath(dataDir: string): string {
  return join(dataDir, 'curation-cache.json');
}

export function readCuratedCache(dataDir: string): CuratedPackage[] {
  const path = curationCachePath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as CuratedPackage[];
    return [];
  } catch {
    return [];
  }
}

export function writeCuratedCache(dataDir: string, items: CuratedPackage[]): void {
  mkdirSync(dataDir, { recursive: true });
  const sorted = [...items].sort((a, b) => b.stars - a.stars);
  atomicWriteFile(curationCachePath(dataDir), JSON.stringify(sorted, null, 2));
}

export function getCuratedItems(dataDir: string): CuratedPackage[] {
  const cached = readCuratedCache(dataDir);
  if (cached.length > 0) return cached;
  return [];
}

interface VerifyResult {
  isGenuine: boolean;
  category: 'mcp' | 'prompt' | 'workflow' | 'skill';
  description: string;
  permissions: { fs?: string[]; net?: string[]; exec?: string[] };
  installHint: string | null;
  tags: string[];
}

async function callOpencodeModel(prompt: string, retries = MAX_RETRIES): Promise<string | null> {
  const model = FREE_MODELS[0];
  const modelArg = model.includes('/') ? model : `opencode/${model}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const result = await new Promise<string | null>((resolve) => {
      const child = spawn('opencode', ['run', '--format', 'json', '--model', modelArg, prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });
      let response = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 45000);

      child.stdout.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'text' && ev.part?.text) response += ev.part.text;
          } catch {
            // skip
          }
        }
      });

      child.on('close', () => {
        clearTimeout(timer);
        resolve(response || null);
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
    if (result) return result;
  }
  return null;
}

function buildVerifyPrompt(name: string, readme: string): string {
  const maxChars = 10000;
  const trimmed =
    readme.length > maxChars ? readme.slice(0, maxChars) + '\n...(truncated)' : readme;
  return `<system>
You are analyzing an open-source repository README. Determine if this is a genuine MCP server, AI prompt library, workflow template, or OpenCode skill.

Return ONLY valid JSON with these fields:
- "isGenuine": boolean (true if it's clearly a real MCP server, prompt collection, workflow template, or skill; false if it's unrelated, a tutorial, a framework, or a library that happens to use MCP)
- "category": one of "mcp" (Model Context Protocol server), "prompt" (AI prompt templates), "workflow" (agent workflow template), "skill" (OpenCode/openhands skill)
- "description": max 20 words, concise factual summary
- "permissions": object with optional "fs" (string[] of filesystem paths), "net" (string[] of network permissions), "exec" (string[] of executable permissions); empty object if none found
- "installHint": the primary install command/method as a single line, or null if unclear
- "tags": array of 2-5 relevant lowercase tags

Examples of genuine items:
- A repo with topic "mcp-server" that implements the MCP protocol with tools/resources
- A collection of prompt templates for Claude/GPT
- A workflow .mdc/.prompt file collection for agent coding workflows
- A skill package for OpenCode with an opencode.json

Examples of non-genuine items:
- A general-purpose library that happens to have an "mcp" topic tag
- A tutorial or guide about MCP
- A framework for building MCP servers (not a server itself)
- A project that is archived or clearly experimental

<user>
Repo: ${name}

README:
${trimmed}`;
}

function parseVerifyResponse(text: string): VerifyResult | null {
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.isGenuine !== 'boolean') return null;
    return {
      isGenuine: parsed.isGenuine,
      category: parsed.category || 'mcp',
      description: parsed.description || '',
      permissions: parsed.permissions || {},
      installHint: parsed.installHint || null,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : []
    };
  } catch {
    return null;
  }
}

async function verifyWithAi(name: string, readme: string): Promise<VerifyResult | null> {
  const prompt = buildVerifyPrompt(name, readme);
  const response = await callOpencodeModel(prompt);
  if (!response) return null;
  return parseVerifyResponse(response);
}

async function processCandidate(hubItem: HubItem): Promise<CuratedPackage | null> {
  const repoId = hubItem.id.startsWith('gh:') ? hubItem.id.slice(3) : hubItem.id;
  const isHf = hubItem.source === 'hf';

  let readme: string;
  let version: string;

  if (isHf) {
    const meta = await fetchHfRepoMetadata(repoId);
    if (!meta) return null;
    readme = meta.readme;
    version = meta.version;
  } else {
    const meta = await fetchRepoMetadata(repoId);
    if (!meta) return null;
    readme = meta.readme;
    version = meta.commitSha;
  }

  const result = await verifyWithAi(hubItem.name, readme);
  if (!result || !result.isGenuine) return null;

  const published: CuratedPackage = {
    id: hubItem.id,
    name: hubItem.name,
    description: result.description || hubItem.description,
    author: hubItem.author,
    version,
    category: result.category,
    tags: result.tags.length > 0 ? result.tags : hubItem.tags,
    stars: hubItem.stars,
    installs: hubItem.installs,
    repository: hubItem.repository,
    npmPackage: hubItem.npmPackage,
    createdAt: hubItem.createdAt,
    pricing: { kind: 'free' },
    permissions: Object.keys(result.permissions).length > 0 ? result.permissions : undefined,
    installHint: result.installHint ?? undefined,
    aiVerifiedAt: new Date().toISOString()
  };

  return published;
}

export interface CurateAllOptions {
  limit?: number;
  force?: boolean;
  onProgress?: (message: string) => void;
}

export async function curateAll(
  dataDir: string,
  opts: CurateAllOptions = {}
): Promise<CuratedPackage[]> {
  const log = opts.onProgress || ((msg: string) => console.log(msg));
  const limit = opts.limit || MAX_AI_ITEMS;

  let cached: CuratedPackage[] = [];
  if (!opts.force) {
    cached = readCuratedCache(dataDir);
    if (cached.length > 0) {
      log(`Found ${cached.length} cached curated items (use --force to re-curate)`);
      return cached;
    }
  }

  log('Discovering candidates from GitHub and HuggingFace...');
  const candidates = await discoverCandidates();
  log(`Found ${candidates.length} candidate items`);

  const results: CuratedPackage[] = [];
  const todo = candidates.slice(0, limit);

  for (let i = 0; i < todo.length; i++) {
    const item = todo[i]!;
    const label = `[${i + 1}/${todo.length}] ${item.name}`;

    const existing = cached.find((c) => c.id === item.id);
    if (existing && !opts.force) {
      results.push(existing);
      continue;
    }

    log(`${label} — verifying...`);
    const curated = await processCandidate(item);
    if (curated) {
      results.push(curated);
      log(`${label} ✓ verified as ${curated.category}`);
    } else {
      log(`${label} ✗ skipped (not a genuine item)`);
    }

    if ((i + 1) % 5 === 0 || i === todo.length - 1) {
      writeCuratedCache(dataDir, [
        ...cached.filter((c) => !todo.find((t) => t.id === c.id)),
        ...results
      ]);
    }
  }

  writeCuratedCache(dataDir, [
    ...cached.filter((c) => !todo.find((t) => t.id === c.id)),
    ...results
  ]);
  log(`\nDone. ${results.length} items curated and cached`);

  return results;
}

export async function discoverCandidates(): Promise<HubItem[]> {
  const [ghItems, hfItems] = await Promise.all([searchGithub(), searchHuggingFace()]);

  const seen = new Set<string>();
  const items: HubItem[] = [];
  for (const item of [...ghItems, ...hfItems]) {
    if (!seen.has(item.repository)) {
      seen.add(item.repository);
      items.push(item);
    }
  }
  items.sort((a, b) => b.stars - a.stars);
  return items;
}
