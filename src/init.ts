import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
  node: ['mcp-filesystem', 'mcp-github', 'mcp-context7', 'mcp-sequential-thinking'],
  python: ['mcp-filesystem', 'mcp-github', 'mcp-context7', 'mcp-sequential-thinking'],
  rust: ['mcp-filesystem', 'mcp-github', 'mcp-sequential-thinking'],
  go: ['mcp-filesystem', 'mcp-github', 'mcp-sequential-thinking'],
  ruby: ['mcp-filesystem', 'mcp-github', 'mcp-sequential-thinking'],
  java: ['mcp-filesystem', 'mcp-github', 'mcp-sequential-thinking'],
  unknown: ['mcp-filesystem', 'mcp-github', 'mcp-sequential-thinking']
};

const FRAMEWORK_SERVERS: Record<string, string[]> = {
  react: ['mcp-figma', 'mcp-magic', 'mcp-context7'],
  nextjs: ['mcp-figma', 'mcp-magic', 'mcp-context7', 'mcp-supabase'],
  vue: ['mcp-figma', 'mcp-context7'],
  express: ['mcp-postgres', 'mcp-redis'],
  django: ['mcp-postgres'],
  flask: ['mcp-postgres'],
  rails: ['mcp-postgres', 'mcp-redis'],
  spring: ['mcp-postgres']
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
    if (deps.includes('next')) frameworks.push('nextjs');
    if (deps.includes('vue')) frameworks.push('vue');
    if (deps.includes('express')) frameworks.push('express');
  } else if (
    files.has('pyproject.toml') ||
    files.has('setup.py') ||
    files.has('requirements.txt')
  ) {
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

  hasDocker =
    files.has('Dockerfile') || files.has('docker-compose.yml') || files.has('.dockerignore');
  hasCI = files.has('.github/workflows') || files.has('.gitlab-ci.yml') || files.has('Jenkinsfile');
  hasTests = files.has('test') || files.has('tests') || files.has('__tests__') || files.has('spec');
  hasDatabase = deps.some((d) =>
    ['postgres', 'pg', 'mysql', 'sqlite', 'mongodb', 'redis'].includes(d)
  );

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
    if (scan.dependencies.includes('mongodb') || scan.dependencies.includes('mongoose')) {
      serverIds.add('mcp-mongodb');
    }
    if (scan.dependencies.includes('redis') || scan.dependencies.includes('ioredis')) {
      serverIds.add('mcp-redis');
    }
    if (
      scan.dependencies.includes('elasticsearch') ||
      scan.dependencies.includes('@elastic/elasticsearch')
    ) {
      serverIds.add('mcp-elasticsearch');
    }
  }

  workflowIds.add('wf-code-review-arch');

  if (scan.hasTests) workflowIds.add('wf-tdd-cycle');
  if (scan.type === 'node')
    notes.push('Node.js project detected — added filesystem, GitHub, and docs MCP servers.');

  const notesList = [
    scan.hasTests ? 'Tests detected — TDD workflow recommended.' : '',
    scan.hasDocker ? 'Docker detected — containerized project.' : '',
    scan.hasDatabase ? 'Database dependencies detected — added relevant database MCP servers.' : '',
    scan.frameworks.length > 0 ? `Framework(s) detected: ${scan.frameworks.join(', ')}.` : ''
  ].filter(Boolean);

  const servers = resolveServers(Array.from(serverIds));

  for (const server of servers) {
    if (server.npmPackage) {
      commands.push(`npm install -g ${server.npmPackage}`);
    }
  }

  const mcp: OpenCodeConfig['mcp'] = {};
  for (const server of servers) {
    if (server.npmPackage) {
      mcp[server.id] = {
        type: 'local',
        command: ['npx', server.npmPackage],
        enabled: true
      };
    }
  }

  notes.push(...notesList);

  return {
    config: {
      $schema: 'https://opencode.ai/config.json',
      mcp,
      plugin: ['opencode-agora']
    },
    servers: servers.map((s) => s.id),
    workflows: Array.from(workflowIds),
    commands,
    notes
  };
}

export function applyInitPlan(plan: InitPlan, configPath: string): void {
  writeOpenCodeConfig(configPath, plan.config);
}

export function runCommands(commands: string[]): { command: string; ok: boolean }[] {
  const results: { command: string; ok: boolean }[] = [];
  const pattern = /^npm install -g (@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)$/;
  for (const command of commands) {
    const match = pattern.exec(command);
    if (!match) {
      results.push({ command, ok: false });
      continue;
    }
    const pkg = match[1];
    try {
      execFileSync('npm', ['install', '-g', pkg], { stdio: 'pipe', timeout: 120000 });
      results.push({ command, ok: true });
    } catch {
      results.push({ command, ok: false });
    }
  }
  return results;
}

function listFiles(dir: string): Set<string> {
  const files = new Set<string>();
  const candidates = [
    'package.json',
    'pyproject.toml',
    'setup.py',
    'requirements.txt',
    'Cargo.toml',
    'go.mod',
    'Gemfile',
    'pom.xml',
    'build.gradle',
    'Dockerfile',
    'docker-compose.yml',
    '.dockerignore',
    '.github/workflows',
    '.gitlab-ci.yml',
    'Jenkinsfile'
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
  const deps = new Set<string>();

  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const all = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const name of Object.keys(all || {})) deps.add(name);
    } catch {
      // ignore
    }
  }

  const manifestFiles = [
    'requirements.txt',
    'pyproject.toml',
    'Gemfile',
    'pom.xml',
    'build.gradle'
  ];
  const keywords = [
    'django',
    'flask',
    'rails',
    'spring',
    'postgres',
    'pg',
    'mysql',
    'sqlite',
    'mongodb',
    'mongoose',
    'redis',
    'ioredis',
    'elasticsearch'
  ];
  for (const file of manifestFiles) {
    const filePath = join(dir, file);
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, 'utf8').toLowerCase();
      for (const keyword of keywords) {
        if (content.includes(keyword)) deps.add(keyword);
      }
    } catch {
      // ignore
    }
  }

  return Array.from(deps);
}

function resolveServers(ids: string[]) {
  return ids
    .map((id) => samplePackages.find((p) => p.id === id && p.category === 'mcp'))
    .filter(Boolean) as typeof samplePackages;
}
