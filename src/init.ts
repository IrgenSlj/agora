import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { writeOpenCodeConfig } from './config-files.js';
import type { OpenCodeConfig } from './config.js';
import { samplePackages } from './data.js';

export interface ProjectScan {
  type: 'node' | 'python' | 'rust' | 'go' | 'ruby' | 'java' | 'unknown';
  frameworks: string[];
  hasDocker: boolean;
  hasCI: boolean;
  hasTests: boolean;
  hasDatabase: boolean;
  dependencies: string[];
}

export interface InitPlan {
  config: OpenCodeConfig;
  servers: string[];
  workflows: string[];
  commands: string[];
  notes: string[];
}

const CATEGORY_SERVERS: Record<string, string[]> = {
  node: ['mcp-filesystem', 'mcp-github', 'mcp-git', 'mcp-npm-info', 'mcp-sequential-thinking'],
  python: ['mcp-filesystem', 'mcp-github', 'mcp-git', 'mcp-python-repl', 'mcp-sequential-thinking'],
  rust: ['mcp-filesystem', 'mcp-github', 'mcp-git', 'mcp-sequential-thinking'],
  go: ['mcp-filesystem', 'mcp-github', 'mcp-git', 'mcp-sequential-thinking'],
  ruby: ['mcp-filesystem', 'mcp-github', 'mcp-git', 'mcp-sequential-thinking'],
  java: ['mcp-filesystem', 'mcp-github', 'mcp-git', 'mcp-sequential-thinking'],
};

const FRAMEWORK_SERVERS: Record<string, string[]> = {
  react: ['mcp-shadcn', 'mcp-tailwind', 'mcp-figma'],
  nextjs: ['mcp-shadcn', 'mcp-tailwind', 'mcp-figma', 'mcp-supabase'],
  vue: ['mcp-tailwind', 'mcp-figma'],
  express: ['mcp-postgres', 'mcp-redis'],
  django: ['mcp-postgres', 'mcp-python-repl'],
  flask: ['mcp-postgres', 'mcp-python-repl'],
  rails: ['mcp-postgres', 'mcp-redis'],
  spring: ['mcp-postgres', 'mcp-redis', 'mcp-mysql'],
};

export function scanProject(dir: string): ProjectScan {
  const files = listFiles(dir);
  const deps = readDependencies(dir);

  let type: ProjectScan['type'] = 'unknown';
  const frameworks: string[] = [];
  let hasDocker = false;
  let hasCI = false;
  let hasTests = false;
  let hasDatabase = false;

  if (files.has('package.json')) {
    type = 'node';
    if (deps.includes('react') || deps.includes('next')) frameworks.push('react');
    if (deps.includes('next') || deps.includes('next/dist')) frameworks.push('nextjs');
    if (deps.includes('vue')) frameworks.push('vue');
    if (deps.includes('express')) frameworks.push('express');
  } else if (files.has('pyproject.toml') || files.has('setup.py') || files.has('requirements.txt')) {
    type = 'python';
    if (deps.includes('django')) frameworks.push('django');
    if (deps.includes('flask')) frameworks.push('flask');
  } else if (files.has('Cargo.toml')) {
    type = 'rust';
  } else if (files.has('go.mod')) {
    type = 'go';
  } else if (files.has('Gemfile')) {
    type = 'ruby';
    if (deps.includes('rails')) frameworks.push('rails');
  } else if (files.has('pom.xml') || files.has('build.gradle')) {
    type = 'java';
    if (deps.includes('spring')) frameworks.push('spring');
  }

  hasDocker = files.has('Dockerfile') || files.has('docker-compose.yml') || files.has('.dockerignore');
  hasCI = files.has('.github/workflows') || files.has('.gitlab-ci.yml') || files.has('Jenkinsfile');
  hasTests = files.has('test') || files.has('tests') || files.has('__tests__') || files.has('spec');
  hasDatabase = deps.some((d) => ['postgres', 'pg', 'mysql', 'sqlite', 'mongodb', 'redis'].includes(d));

  return { type, frameworks, hasDocker, hasCI, hasTests, hasDatabase, dependencies: deps };
}

export function generateInitPlan(scan: ProjectScan): InitPlan {
  const serverIds = new Set<string>();
  const workflowIds = new Set<string>();
  const commands: string[] = [];
  const notes: string[] = [];

  const defaults = CATEGORY_SERVERS[scan.type] || CATEGORY_SERVERS.unknown;
  defaults.forEach((id) => serverIds.add(id));

  for (const framework of scan.frameworks) {
    const fwServers = FRAMEWORK_SERVERS[framework];
    if (fwServers) fwServers.forEach((id) => serverIds.add(id));
  }

  if (scan.hasDatabase) {
    if (scan.dependencies.includes('pg') || scan.dependencies.includes('postgres')) {
      serverIds.add('mcp-postgres');
    }
    if (scan.dependencies.includes('mysql')) serverIds.add('mcp-mysql');
    if (scan.dependencies.includes('sqlite') || scan.dependencies.includes('better-sqlite3')) {
      serverIds.add('mcp-sqlite');
    }
    if (scan.dependencies.includes('mongodb') || scan.dependencies.includes('mongoose')) {
      serverIds.add('mcp-mongodb');
    }
    if (scan.dependencies.includes('redis') || scan.dependencies.includes('ioredis')) {
      serverIds.add('mcp-redis');
    }
  }

  if (scan.hasDocker) serverIds.add('mcp-docker');
  workflowIds.add('wf-code-review-arch');

  if (scan.hasTests) workflowIds.add('wf-tdd-cycle');
  if (scan.type === 'node') notes.push('Node.js project detected — added npm info, filesystem, and GitHub MCP servers.');

  const notesList = [
    scan.hasTests ? 'Tests detected — TDD workflow recommended.' : '',
    scan.hasDocker ? 'Docker detected — added Docker MCP server.' : '',
    scan.hasDatabase ? 'Database dependencies detected — added relevant database MCP servers.' : '',
    scan.frameworks.length > 0 ? `Framework(s) detected: ${scan.frameworks.join(', ')}.` : '',
  ].filter(Boolean);

  const servers = resolveServers(Array.from(serverIds));

  for (const server of servers) {
    if (server.npmPackage) {
      commands.push(`npm install -g ${server.npmPackage}`);
    }
  }

  const mcpServers: OpenCodeConfig['mcpServers'] = {};
  for (const server of servers) {
    if (server.npmPackage) {
      mcpServers[server.id] = {
        command: 'npx',
        args: [server.npmPackage],
        env: {},
      };
    }
  }

  notes.push(...notesList);

  return {
    config: {
      $schema: 'https://opencode.ai/config.json',
      mcpServers,
      plugins: ['opencode-agora'],
    },
    servers: Array.from(serverIds),
    workflows: Array.from(workflowIds),
    commands,
    notes,
  };
}

export function applyInitPlan(plan: InitPlan, configPath: string): void {
  writeOpenCodeConfig(configPath, plan.config);
}

export function runCommands(commands: string[]): void {
  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 120000 });
    } catch {
      // Best effort — some packages may already be installed
    }
  }
}

function listFiles(dir: string): Set<string> {
  const files = new Set<string>();
  const candidates = [
    'package.json',
    'pyproject.toml', 'setup.py', 'requirements.txt',
    'Cargo.toml',
    'go.mod',
    'Gemfile',
    'pom.xml', 'build.gradle',
    'Dockerfile', 'docker-compose.yml', '.dockerignore',
    '.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile',
  ];
  for (const file of candidates) {
    if (existsSync(join(dir, file))) {
      files.add(file);
    }
  }
  const testDirs = ['test', 'tests', '__tests__', 'spec'];
  for (const d of testDirs) {
    if (existsSync(join(dir, d))) files.add(d);
  }
  return files;
}

function readDependencies(dir: string): string[] {
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const all = { ...pkg.dependencies, ...pkg.devDependencies };
      return Object.keys(all || {});
    } catch {
      // ignore
    }
  }
  return [];
}

function resolveServers(ids: string[]) {
  return ids
    .map((id) => samplePackages.find((p) => p.id === id && p.category === 'mcp'))
    .filter(Boolean) as typeof samplePackages;
}


