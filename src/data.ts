import type { Package, Workflow, Discussion, Tutorial } from './types.js';

export const dataRefreshedAt = '2026-05-14';

export const samplePackages: Package[] = [
  // ── Filesystem & Core I/O ──
  {
    id: 'mcp-filesystem',
    name: '@modelcontextprotocol/server-filesystem',
    description: 'Secure file read/write, directory operations, search, and metadata access with configurable access control',
    author: 'modelcontextprotocol',
    version: '2026.1.14',
    category: 'mcp',
    tags: ['filesystem', 'files', 'io', 'security', 'official'],
    stars: 4850,
    installs: 189000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-filesystem',
    createdAt: '2024-08-15'
  },
  {
    id: 'mcp-github',
    name: '@modelcontextprotocol/server-github',
    description: 'Full GitHub API integration — issues, PRs, repos, search, file contents, and releases',
    author: 'modelcontextprotocol',
    version: '2025.4.8',
    category: 'mcp',
    tags: ['github', 'git', 'api', 'official', 'devtools'],
    stars: 5200,
    installs: 245000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-github',
    createdAt: '2024-09-01'
  },
  {
    id: 'mcp-git',
    name: '@modelcontextprotocol/server-git',
    description: 'Git operations — commit, diff, log, branch management, status checks',
    author: 'modelcontextprotocol',
    version: '2026.1.14',
    category: 'mcp',
    tags: ['git', 'version-control', 'official', 'devtools'],
    stars: 2100,
    installs: 78000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-git',
    createdAt: '2024-10-01'
  },
  {
    id: 'mcp-brave-search',
    name: '@modelcontextprotocol/server-brave-search',
    description: 'Web search and local business queries using the Brave Search API',
    author: 'modelcontextprotocol',
    version: '0.6.2',
    category: 'mcp',
    tags: ['search', 'web', 'brave', 'api', 'official'],
    stars: 1800,
    installs: 93000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-brave-search',
    createdAt: '2024-10-05'
  },

  // ── Database Servers ──
  {
    id: 'mcp-postgres',
    name: '@modelcontextprotocol/server-postgres',
    description: 'Read/write PostgreSQL databases — schema inspection, queries, and transaction support',
    author: 'modelcontextprotocol',
    version: '0.6.2',
    category: 'mcp',
    tags: ['postgresql', 'database', 'sql', 'official', 'data'],
    stars: 3400,
    installs: 112000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-postgres',
    createdAt: '2024-11-01'
  },
  {
    id: 'mcp-sqlite',
    name: '@modelcontextprotocol/server-sqlite',
    description: 'SQLite database access — query, schema exploration, and data manipulation',
    author: 'modelcontextprotocol',
    version: '2026.1.14',
    category: 'mcp',
    tags: ['sqlite', 'database', 'sql', 'official', 'data'],
    stars: 2200,
    installs: 67000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-sqlite',
    createdAt: '2024-11-15'
  },
  {
    id: 'mcp-redis',
    name: '@modelcontextprotocol/server-redis',
    description: 'Redis key-value store operations — get/set, list management, and cache control',
    author: 'modelcontextprotocol',
    version: '2025.4.25',
    category: 'mcp',
    tags: ['redis', 'cache', 'database', 'official', 'data'],
    stars: 1200,
    installs: 34000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-redis',
    createdAt: '2024-12-01'
  },

  // ── AI & Memory ──
  {
    id: 'mcp-sequential-thinking',
    name: '@modelcontextprotocol/server-sequential-thinking',
    description: 'Structured multi-step reasoning with branching, revision, and chain-of-thought',
    author: 'modelcontextprotocol',
    version: '2025.12.18',
    category: 'mcp',
    tags: ['reasoning', 'thinking', 'ai', 'official'],
    stars: 4100,
    installs: 156000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-sequential-thinking',
    createdAt: '2024-10-20'
  },
  {
    id: 'mcp-memory',
    name: '@modelcontextprotocol/server-memory',
    description: 'Persistent knowledge graph memory for cross-session context retention',
    author: 'modelcontextprotocol',
    version: '2026.1.26',
    category: 'mcp',
    tags: ['memory', 'knowledge-graph', 'persistence', 'official'],
    stars: 3900,
    installs: 134000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-memory',
    createdAt: '2024-10-15'
  },

  // ── Browser Automation ──
  {
    id: 'mcp-puppeteer',
    name: '@modelcontextprotocol/server-puppeteer',
    description: 'Headless Chrome browser automation — navigation, screenshots, PDF generation, and JavaScript evaluation',
    author: 'modelcontextprotocol',
    version: '2025.5.12',
    category: 'mcp',
    tags: ['browser', 'automation', 'puppeteer', 'official', 'web'],
    stars: 3100,
    installs: 89000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-puppeteer',
    createdAt: '2024-09-20'
  },
  {
    id: 'mcp-playwright',
    name: '@modelcontextprotocol/server-playwright',
    description: 'Cross-browser automation with Playwright — multi-page, mobile emulation, and network interception',
    author: 'modelcontextprotocol',
    version: '2026.1.14',
    category: 'mcp',
    tags: ['browser', 'automation', 'playwright', 'official', 'testing'],
    stars: 1900,
    installs: 56000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-playwright',
    createdAt: '2024-11-10'
  },

  // ── Communication ──
  {
    id: 'mcp-slack',
    name: '@modelcontextprotocol/server-slack',
    description: 'Slack workspace integration — messaging, channel management, search, and user presence',
    author: 'modelcontextprotocol',
    version: '2025.4.25',
    category: 'mcp',
    tags: ['slack', 'communication', 'messaging', 'official'],
    stars: 2600,
    installs: 72000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-slack',
    createdAt: '2024-10-10'
  },

  // ── Monitoring & observability ──
  {
    id: 'mcp-sentry',
    name: '@modelcontextprotocol/server-sentry',
    description: 'Sentry error tracking and performance monitoring — issue management, events, and metrics',
    author: 'modelcontextprotocol',
    version: '2026.1.14',
    category: 'mcp',
    tags: ['sentry', 'monitoring', 'errors', 'observability', 'official'],
    stars: 1100,
    installs: 28000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-sentry',
    createdAt: '2024-12-10'
  },
  {
    id: 'mcp-cloudflare',
    name: '@modelcontextprotocol/server-cloudflare',
    description: 'Cloudflare API — DNS, Workers, KV, R2, D1, and account management',
    author: 'modelcontextprotocol',
    version: '2026.1.14',
    category: 'mcp',
    tags: ['cloudflare', 'dns', 'workers', 'infrastructure', 'official'],
    stars: 1400,
    installs: 31000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-cloudflare',
    createdAt: '2025-01-05'
  },

  // ── Community servers ──
  {
    id: 'mcp-docker',
    name: '@anthropic/server-docker',
    description: 'Docker container lifecycle management — build, run, stop, logs, and compose operations',
    author: 'anthropic',
    version: '1.2.0',
    category: 'mcp',
    tags: ['docker', 'containers', 'infrastructure', 'devops'],
    stars: 1800,
    installs: 45000,
    repository: 'https://github.com/anthropics/mcp-docker',
    npmPackage: '@anthropic/server-docker',
    createdAt: '2025-02-01'
  },
  {
    id: 'mcp-tavily',
    name: '@tavily/mcp-server',
    description: 'AI-optimized web search with Tavily — real-time data for LLM contexts',
    author: 'tavily',
    version: '0.3.0',
    category: 'mcp',
    tags: ['search', 'web', 'ai', 'tavily'],
    stars: 890,
    installs: 23000,
    repository: 'https://github.com/tavily-ai/mcp-server',
    npmPackage: '@tavily/mcp-server',
    createdAt: '2025-02-15'
  },
  {
    id: 'mcp-firecrawl',
    name: '@mendable/firecrawl-mcp',
    description: 'Web scraping with JavaScript rendering, crawl support, and markdown output',
    author: 'mendable',
    version: '1.1.0',
    category: 'mcp',
    tags: ['scraping', 'web', 'crawl', 'markdown'],
    stars: 1200,
    installs: 34000,
    repository: 'https://github.com/mendableai/firecrawl-mcp',
    npmPackage: '@mendable/firecrawl-mcp',
    createdAt: '2025-03-01'
  },
  {
    id: 'mcp-kubernetes',
    name: '@anthropic/server-kubernetes',
    description: 'Kubernetes cluster management — pods, deployments, services, logs, and config',
    author: 'anthropic',
    version: '0.5.0',
    category: 'mcp',
    tags: ['kubernetes', 'k8s', 'containers', 'infrastructure', 'devops'],
    stars: 980,
    installs: 21000,
    repository: 'https://github.com/anthropics/mcp-kubernetes',
    npmPackage: '@anthropic/server-kubernetes',
    createdAt: '2025-02-20'
  },
  {
    id: 'mcp-jira',
    name: '@atlassian/mcp-jira',
    description: 'Jira issue tracking — create, update, search, and manage tickets and sprints',
    author: 'atlassian',
    version: '0.4.0',
    category: 'mcp',
    tags: ['jira', 'atlassian', 'project-management', 'issues'],
    stars: 760,
    installs: 18000,
    repository: 'https://github.com/atlassian/mcp-jira',
    npmPackage: '@atlassian/mcp-jira',
    createdAt: '2025-03-10'
  },
  {
    id: 'mcp-linear',
    name: '@modelcontextprotocol/server-linear',
    description: 'Linear issue tracking — create, update, search issues, and manage projects',
    author: 'modelcontextprotocol',
    version: '2026.1.14',
    category: 'mcp',
    tags: ['linear', 'project-management', 'issues', 'official'],
    stars: 640,
    installs: 12000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-linear',
    createdAt: '2025-01-15'
  },
  {
    id: 'mcp-notion',
    name: '@notionhq/mcp-server',
    description: 'Notion workspace integration — pages, databases, search, and content management',
    author: 'notion',
    version: '0.3.0',
    category: 'mcp',
    tags: ['notion', 'documentation', 'knowledge-base'],
    stars: 1500,
    installs: 42000,
    repository: 'https://github.com/notionhq/mcp-server',
    npmPackage: '@notionhq/mcp-server',
    createdAt: '2025-03-15'
  },
  {
    id: 'mcp-figma',
    name: '@figma/mcp-server',
    description: 'Figma file access — read components, styles, and design tokens for design-to-code',
    author: 'figma',
    version: '0.2.0',
    category: 'mcp',
    tags: ['figma', 'design', 'design-tokens', 'frontend'],
    stars: 1100,
    installs: 29000,
    repository: 'https://github.com/figma/mcp-server',
    npmPackage: '@figma/mcp-server',
    createdAt: '2025-04-01'
  },
  {
    id: 'mcp-shadcn',
    name: '@shadcn/mcp-server',
    description: 'shadcn/ui component library — browse, install, and configure UI components',
    author: 'shadcn',
    version: '0.1.0',
    category: 'mcp',
    tags: ['shadcn', 'ui', 'components', 'react', 'frontend'],
    stars: 2100,
    installs: 56000,
    repository: 'https://github.com/shadcn/mcp-server',
    npmPackage: '@shadcn/mcp-server',
    createdAt: '2025-04-10'
  },
  {
    id: 'mcp-tailwind',
    name: '@tailwindlabs/mcp-server',
    description: 'Tailwind CSS — class suggestions, config validation, and design system queries',
    author: 'tailwindlabs',
    version: '0.1.0',
    category: 'mcp',
    tags: ['tailwind', 'css', 'design', 'frontend'],
    stars: 1300,
    installs: 31000,
    repository: 'https://github.com/tailwindlabs/mcp-server',
    npmPackage: '@tailwindlabs/mcp-server',
    createdAt: '2025-04-15'
  },
  {
    id: 'mcp-npm-info',
    name: '@snyk-labs/mcp-server-npm',
    description: 'npm package metadata lookup — versions, dependencies, health, and security info',
    author: 'snyk-labs',
    version: '1.0.0',
    category: 'mcp',
    tags: ['npm', 'packages', 'security', 'javascript'],
    stars: 340,
    installs: 8900,
    repository: 'https://github.com/snyk-labs/mcp-server-npm',
    npmPackage: '@snyk-labs/mcp-server-npm',
    createdAt: '2025-03-20'
  },
  {
    id: 'mcp-supabase',
    name: '@supabase/mcp-server',
    description: 'Supabase project management — database, auth, storage, and edge functions',
    author: 'supabase',
    version: '0.5.0',
    category: 'mcp',
    tags: ['supabase', 'database', 'backend', 'baas'],
    stars: 780,
    installs: 15000,
    repository: 'https://github.com/supabase/mcp-server',
    npmPackage: '@supabase/mcp-server',
    createdAt: '2025-04-05'
  },
  {
    id: 'mcp-stripe',
    name: '@stripe/mcp-server',
    description: 'Stripe payments — charges, customers, products, subscriptions, and webhooks',
    author: 'stripe',
    version: '0.3.0',
    category: 'mcp',
    tags: ['stripe', 'payments', 'billing', 'commerce'],
    stars: 920,
    installs: 22000,
    repository: 'https://github.com/stripe/mcp-server',
    npmPackage: '@stripe/mcp-server',
    createdAt: '2025-04-20'
  },
  {
    id: 'mcp-python-repl',
    name: '@modelcontextprotocol/server-python-repl',
    description: 'Execute Python code in a sandboxed REPL environment',
    author: 'modelcontextprotocol',
    version: '2026.1.14',
    category: 'mcp',
    tags: ['python', 'repl', 'execution', 'official'],
    stars: 1500,
    installs: 44000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-python-repl',
    createdAt: '2024-12-15'
  },
  {
    id: 'mcp-openapi',
    name: '@anthropic/server-openapi',
    description: 'OpenAPI/Swagger — discover and call REST APIs from their OpenAPI specs',
    author: 'anthropic',
    version: '0.4.0',
    category: 'mcp',
    tags: ['openapi', 'rest', 'api', 'swagger', 'integration'],
    stars: 670,
    installs: 14000,
    repository: 'https://github.com/anthropics/mcp-openapi',
    npmPackage: '@anthropic/server-openapi',
    createdAt: '2025-02-10'
  },
  {
    id: 'mcp-obsidian',
    name: '@obsidianmd/mcp-server',
    description: 'Obsidian vault access — read, search, and create notes and links',
    author: 'obsidian',
    version: '0.2.0',
    category: 'mcp',
    tags: ['obsidian', 'notes', 'knowledge-base', 'markdown'],
    stars: 1100,
    installs: 27000,
    repository: 'https://github.com/obsidianmd/mcp-server',
    npmPackage: '@obsidianmd/mcp-server',
    createdAt: '2025-03-25'
  },
  {
    id: 'mcp-grafana',
    name: '@grafana/mcp-server',
    description: 'Grafana dashboards and alerts — query metrics, manage dashboards, investigate incidents',
    author: 'grafana',
    version: '0.3.0',
    category: 'mcp',
    tags: ['grafana', 'monitoring', 'metrics', 'observability'],
    stars: 560,
    installs: 11000,
    repository: 'https://github.com/grafana/mcp-server',
    npmPackage: '@grafana/mcp-server',
    createdAt: '2025-04-25'
  },
  {
    id: 'mcp-datadog',
    name: '@datadog/mcp-server',
    description: 'Datadog monitoring — metrics, logs, traces, dashboards, and incident management',
    author: 'datadog',
    version: '0.2.0',
    category: 'mcp',
    tags: ['datadog', 'monitoring', 'observability', 'logs'],
    stars: 480,
    installs: 9500,
    repository: 'https://github.com/datadog/mcp-server',
    npmPackage: '@datadog/mcp-server',
    createdAt: '2025-05-01'
  },
  {
    id: 'mcp-pagerduty',
    name: '@pagerduty/mcp-server',
    description: 'PagerDuty incident response — manage incidents, on-call schedules, and services',
    author: 'pagerduty',
    version: '0.1.0',
    category: 'mcp',
    tags: ['pagerduty', 'incident', 'oncall', 'devops'],
    stars: 320,
    installs: 7200,
    repository: 'https://github.com/pagerduty/mcp-server',
    npmPackage: '@pagerduty/mcp-server',
    createdAt: '2025-05-10'
  },
  {
    id: 'mcp-aws',
    name: '@anthropic/server-aws',
    description: 'AWS resource management — EC2, S3, Lambda, IAM, and CloudFormation',
    author: 'anthropic',
    version: '0.6.0',
    category: 'mcp',
    tags: ['aws', 'cloud', 'infrastructure', 'devops'],
    stars: 1300,
    installs: 35000,
    repository: 'https://github.com/anthropics/mcp-aws',
    npmPackage: '@anthropic/server-aws',
    createdAt: '2025-03-01'
  },
  {
    id: 'mcp-gcp',
    name: '@anthropic/server-gcp',
    description: 'Google Cloud Platform — GCS, Cloud Run, GKE, IAM, and Cloud SQL',
    author: 'anthropic',
    version: '0.3.0',
    category: 'mcp',
    tags: ['gcp', 'cloud', 'infrastructure', 'devops'],
    stars: 540,
    installs: 13000,
    repository: 'https://github.com/anthropics/mcp-gcp',
    npmPackage: '@anthropic/server-gcp',
    createdAt: '2025-04-01'
  },
  {
    id: 'mcp-elasticsearch',
    name: '@elastic/mcp-server',
    description: 'Elasticsearch — search, indexing, cluster health, and query management',
    author: 'elastic',
    version: '0.2.0',
    category: 'mcp',
    tags: ['elasticsearch', 'search', 'analytics', 'data'],
    stars: 410,
    installs: 8500,
    repository: 'https://github.com/elastic/mcp-server',
    npmPackage: '@elastic/mcp-server',
    createdAt: '2025-05-05'
  },
  {
    id: 'mcp-confluence',
    name: '@atlassian/mcp-confluence',
    description: 'Confluence — create, edit, and search pages, spaces, and attachments',
    author: 'atlassian',
    version: '0.2.0',
    category: 'mcp',
    tags: ['confluence', 'documentation', 'wiki', 'atlassian'],
    stars: 380,
    installs: 7800,
    repository: 'https://github.com/atlassian/mcp-confluence',
    npmPackage: '@atlassian/mcp-confluence',
    createdAt: '2025-05-15'
  },
  {
    id: 'mcp-sonar',
    name: '@sonarsource/mcp-server',
    description: 'SonarQube code quality — issues, metrics, and quality gates for code analysis',
    author: 'sonarsource',
    version: '0.1.0',
    category: 'mcp',
    tags: ['sonarqube', 'code-quality', 'linting', 'analysis'],
    stars: 290,
    installs: 5600,
    repository: 'https://github.com/SonarSource/mcp-server',
    npmPackage: '@sonarsource/mcp-server',
    createdAt: '2025-05-20'
  },
  {
    id: 'mcp-selenium',
    name: '@anthropic/server-selenium',
    description: 'Selenium WebDriver — browser automation with full webdriver protocol support',
    author: 'anthropic',
    version: '0.3.0',
    category: 'mcp',
    tags: ['selenium', 'browser', 'automation', 'testing'],
    stars: 520,
    installs: 11000,
    repository: 'https://github.com/anthropics/mcp-selenium',
    npmPackage: '@anthropic/server-selenium',
    createdAt: '2025-03-05'
  },
  {
    id: 'mcp-mongodb',
    name: '@mongodb/mcp-server',
    description: 'MongoDB — document queries, aggregation pipelines, indexing, and schema analysis',
    author: 'mongodb',
    version: '0.2.0',
    category: 'mcp',
    tags: ['mongodb', 'database', 'nosql', 'data'],
    stars: 680,
    installs: 16000,
    repository: 'https://github.com/mongodb/mcp-server',
    npmPackage: '@mongodb/mcp-server',
    createdAt: '2025-04-15'
  },
  {
    id: 'mcp-mysql',
    name: '@modelcontextprotocol/server-mysql',
    description: 'MySQL database — queries, schema exploration, and transaction management',
    author: 'modelcontextprotocol',
    version: '2026.1.14',
    category: 'mcp',
    tags: ['mysql', 'database', 'sql', 'official', 'data'],
    stars: 980,
    installs: 25000,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-mysql',
    createdAt: '2025-01-20'
  },
  {
    id: 'mcp-s3',
    name: '@anthropic/server-s3',
    description: 'Amazon S3 — bucket management, object operations, presigned URLs, and multipart uploads',
    author: 'anthropic',
    version: '0.4.0',
    category: 'mcp',
    tags: ['s3', 'aws', 'storage', 'cloud'],
    stars: 760,
    installs: 19000,
    repository: 'https://github.com/anthropics/mcp-s3',
    npmPackage: '@anthropic/server-s3',
    createdAt: '2025-03-15'
  },
  {
    id: 'mcp-ollama',
    name: '@anthropic/server-ollama',
    description: 'Ollama local LLM inference — run and manage local models directly from OpenCode',
    author: 'anthropic',
    version: '0.3.0',
    category: 'mcp',
    tags: ['ollama', 'llm', 'local', 'ai', 'inference'],
    stars: 2600,
    installs: 68000,
    repository: 'https://github.com/anthropics/mcp-ollama',
    npmPackage: '@anthropic/server-ollama',
    createdAt: '2025-03-20'
  },

  // ── Prompts ──
  {
    id: 'prompt-code-review',
    name: 'Comprehensive Code Review',
    description: 'Multi-faceted code review covering security, performance, correctness, and best practices',
    author: 'agora-community',
    version: '2.0.0',
    category: 'prompt',
    tags: ['review', 'security', 'best-practices', 'quality'],
    stars: 1200,
    installs: 8900,
    createdAt: '2025-01-10'
  },
  {
    id: 'prompt-api-design',
    name: 'API Design Review',
    description: 'Review REST/GraphQL API designs for consistency, scalability, and developer experience',
    author: 'agora-community',
    version: '1.1.0',
    category: 'prompt',
    tags: ['api', 'design', 'rest', 'graphql'],
    stars: 560,
    installs: 3400,
    createdAt: '2025-02-20'
  },
  {
    id: 'prompt-refactor-plan',
    name: 'Refactoring Strategy',
    description: 'Plan and execute safe, incremental codebase refactoring with test coverage',
    author: 'agora-community',
    version: '1.0.0',
    category: 'prompt',
    tags: ['refactor', 'planning', 'safety', 'testing'],
    stars: 780,
    installs: 4500,
    createdAt: '2025-03-01'
  },


];

export const sampleWorkflows: Workflow[] = [
  {
    id: 'wf-tdd-cycle',
    name: 'TDD Development Cycle',
    description: 'Test-driven development — write failing test, implement, refactor. Repeat.',
    author: 'testdriven',
    prompt: `You are following TDD methodology. For each feature request:
1. Write a failing test first
2. Write minimal code to pass the test
3. Refactor while keeping tests green

Always start by understanding the requirements and writing tests that describe expected behavior.`,
    model: 'claude-sonnet-4-5',
    tags: ['tdd', 'testing', 'workflow', 'methodology'],
    stars: 456,
    forks: 89,
    createdAt: '2025-01-20'
  },
  {
    id: 'wf-security-audit',
    name: 'Security Audit Workflow',
    description: 'Thorough security analysis covering OWASP Top 10, secrets, and dependency vulnerabilities',
    author: 'security-first',
    prompt: `Perform a thorough security audit of the codebase:
1. Check for OWASP Top 10 vulnerabilities
2. Look for hardcoded secrets and credentials
3. Validate input sanitization
4. Check dependency vulnerabilities
5. Review authentication and authorization
6. Verify CSRF and XSS protections

Report findings with severity levels (Critical/High/Medium/Low) and suggested fixes.`,
    tags: ['security', 'audit', 'owasp', 'vulnerability'],
    stars: 234,
    forks: 45,
    createdAt: '2025-02-01'
  },
  {
    id: 'wf-api-design',
    name: 'API Design Review',
    description: 'Review API endpoints for RESTful best practices, consistency, and developer experience',
    author: 'api-craft',
    prompt: `Review the API design against these criteria:
1. RESTful resource naming consistency
2. HTTP method usage correctness
3. Request/response structure
4. Error handling and status codes
5. Authentication and authorization
6. Pagination, filtering, and sorting patterns
7. Rate limiting documentation
8. Versioning strategy

Provide specific recommendations for each issue found.`,
    tags: ['api', 'design', 'review', 'rest'],
    stars: 189,
    forks: 34,
    createdAt: '2025-02-15'
  },
  {
    id: 'wf-refactor-large',
    name: 'Large Scale Refactor',
    description: 'Safe, incremental refactoring strategy for large codebases with minimal risk',
    author: 'agora-community',
    prompt: `Plan and execute a large-scale refactor:
1. Map the current architecture and dependencies
2. Identify refactoring targets by risk level
3. Break the refactor into small, reversible steps
4. Ensure test coverage before each change
5. Execute changes incrementally
6. Verify no regressions after each step
7. Update documentation

Always prioritize keeping the system working over speed of refactoring.`,
    tags: ['refactor', 'large-scale', 'safety', 'incremental'],
    stars: 312,
    forks: 67,
    createdAt: '2025-02-15'
  },
  {
    id: 'wf-db-migration',
    name: 'Database Migration Review',
    description: 'Review SQL migrations for safety, performance, and rollback readiness',
    author: 'dba-master',
    prompt: `Review the database migration:
1. Check for backward compatibility
2. Verify index usage and query performance
3. Ensure rollback script exists and works
4. Check data type correctness
5. Validate constraint and foreign key handling
6. Review for locking concerns
7. Confirm zero-downtime deploy compatibility

Flag any migration that could cause data loss or extended downtime.`,
    tags: ['database', 'migration', 'sql', 'safety'],
    stars: 156,
    forks: 28,
    createdAt: '2025-03-01'
  },
  {
    id: 'wf-code-review-arch',
    name: 'Architecture Review',
    description: 'High-level architecture review focusing on modularity, coupling, and scalability',
    author: 'arch-wizard',
    prompt: `Review the architecture:
1. Evaluate module boundaries and separation of concerns
2. Check for circular dependencies
3. Review error propagation patterns
4. Assess scalability of the design
5. Verify logging and observability
6. Check configuration management
7. Review testing strategy completeness

Provide a score (1-10) for each dimension with actionable improvements.`,
    tags: ['architecture', 'review', 'design', 'scalability'],
    stars: 198,
    forks: 42,
    createdAt: '2025-03-10'
  },
  {
    id: 'wf-dependency-audit',
    name: 'Dependency Audit',
    description: 'Audit project dependencies for security, licensing, and maintenance status',
    author: 'safety-first',
    prompt: `Audit all project dependencies:
1. Check for known CVEs in each dependency
2. Review license compatibility with your project
3. Evaluate maintenance activity (last commit, release cadence)
4. Identify unused or duplicate dependencies
5. Check for deprecated packages
6. Verify lockfile integrity
7. Suggest alternatives for problematic dependencies

Priority order: security issues first, licensing second, maintenance third.`,
    tags: ['dependencies', 'security', 'audit', 'npm'],
    stars: 134,
    forks: 23,
    createdAt: '2025-03-20'
  },
  {
    id: 'wf-performance-audit',
    name: 'Performance Audit',
    description: 'Identify and fix performance bottlenecks in code and database queries',
    author: 'perf-nerd',
    prompt: `Conduct a performance audit:
1. Identify N+1 query patterns
2. Review algorithm complexity (Big O)
3. Check for memory leaks
4. Review caching strategy
5. Analyze bundle size and tree-shaking
6. Check lazy-loading opportunities
7. Review database query performance with EXPLAIN ANALYZE

Quantify improvements where possible (e.g., "reduces page load from 3s to 200ms").`,
    tags: ['performance', 'optimization', 'audit', 'profiling'],
    stars: 167,
    forks: 31,
    createdAt: '2025-04-01'
  },
  {
    id: 'wf-ci-cd-review',
    name: 'CI/CD Pipeline Review',
    description: 'Review CI/CD configuration for speed, reliability, and security best practices',
    author: 'devops-pro',
    prompt: `Review the CI/CD pipeline:
1. Check build caching effectiveness
2. Verify test parallelization
3. Review deployment stages and gates
4. Check secret management
5. Verify rollback procedures
6. Review notification and alerting
7. Check pipeline security (supply chain)

Suggest specific config changes to reduce pipeline time and improve reliability.`,
    tags: ['ci-cd', 'devops', 'pipeline', 'automation'],
    stars: 112,
    forks: 19,
    createdAt: '2025-04-10'
  },
  {
    id: 'wf-new-project',
    name: 'New Project Scaffold',
    description: 'Scaffold a new project with best-practice structure, tooling, and configuration',
    author: 'agora-community',
    prompt: `Scaffold a new project:
1. Set up the project structure following community best practices
2. Configure TypeScript/linting/formatting
3. Set up testing framework
4. Configure CI/CD
5. Add editor config and git hooks
6. Create README with badges
7. Set up dependency management
8. Add Docker support if applicable

Ask about the project type first, then generate a complete scaffold.`,
    tags: ['scaffold', 'new-project', 'setup', 'boilerplate'],
    stars: 278,
    forks: 52,
    createdAt: '2025-04-15'
  }
];

export const sampleDiscussions: Discussion[] = [
  {
    id: 'disc-mcp-vs-openai',
    title: 'MCP Servers vs OpenAI Function Calling — When to use which?',
    author: 'devarchitect',
    content: 'I have been experimenting with both approaches. MCP seems more flexible for tool-based workflows since any client can use any server, but function calling is simpler to set up for single-provider apps. What is your experience and when do you reach for each?',
    category: 'question',
    replies: 23,
    stars: 45,
    createdAt: '2025-03-01'
  },
  {
    id: 'disc-best-coder-model',
    title: 'Best model for coding in 2026?',
    author: 'local-llm-fan',
    content: 'With Claude Opus 4.5, Gemini 2.5 Pro, GPT-5, DeepSeek V4, and Qwen4 all available — what are you using for daily development? Any standout for agentic coding workflows?',
    category: 'discussion',
    replies: 67,
    stars: 89,
    createdAt: '2025-03-10'
  },
  {
    id: 'disc-agora-init',
    title: 'Showcase: Zero-to-productive OpenCode setup in one command',
    author: 'agora-core',
    content: 'Just built an init flow that scans your project and generates the perfect opencode.json automatically. Node project? Gets the npm MCP servers. Python? Gets the right tools. Try `agora init` in your project!',
    category: 'showcase',
    replies: 12,
    stars: 34,
    createdAt: '2025-04-01'
  },
  {
    id: 'disc-mcp-security',
    title: 'Security considerations for MCP servers in production',
    author: 'sec-ops',
    content: 'What are people doing to secure MCP servers in production? I am particularly concerned about filesystem access scope, credential management, and rate limiting. Curious to hear what patterns the community has settled on.',
    category: 'question',
    replies: 31,
    stars: 56,
    createdAt: '2025-03-15'
  },
  {
    id: 'disc-workflow-sharing',
    title: 'Idea: Community workflow registry with versioning',
    author: 'wf-creator',
    content: 'What if we could version-control and share workflows like npm packages? Publish a workflow, others can install it with `agora use`, fork it, improve it, and contribute back. Think npm for agent workflows.',
    category: 'idea',
    replies: 18,
    stars: 42,
    createdAt: '2025-04-05'
  },
  {
    id: 'disc-local-vs-remote',
    title: 'Local models catching up — is 2026 the year of local coding?',
    author: 'offline-first',
    content: 'With Qwen4-72B and DeepSeek V4 running on consumer hardware, are we finally at the point where local models can replace cloud API for everyday coding? What is your local setup looking like?',
    category: 'discussion',
    replies: 45,
    stars: 78,
    createdAt: '2025-04-10'
  },
  {
    id: 'disc-mcp-server-list',
    title: 'What is your must-have MCP server stack?',
    author: 'stack-builder',
    content: 'Mine: filesystem (obvious), GitHub (dev workflow), sequential-thinking (complex reasoning), memory (context retention), and postgres (data access). What are your non-negotiables?',
    category: 'discussion',
    replies: 38,
    stars: 63,
    createdAt: '2025-04-15'
  }
];

export const sampleTutorials: Tutorial[] = [
  {
    id: 'tut-mcp-basics',
    title: 'MCP Servers 101',
    description: 'Learn the fundamentals of Model Context Protocol and how to use it with OpenCode',
    level: 'beginner',
    duration: '15 min',
    steps: [
      {
        title: 'What is MCP?',
        content: 'The Model Context Protocol (MCP) is an open standard that lets AI models connect with external tools and data sources. Think of it as a USB-C port for AI — a universal way to plug any AI into any tool. MCP was created by Anthropic and is now governed by the Linux Foundation\'s Agentic AI Foundation.',
      },
      {
        title: 'Installing Your First MCP Server',
        content: 'Let\'s install the filesystem MCP server. OpenCode uses MCP servers to access your files, run commands, and interact with APIs.',
        code: `npm install -g @modelcontextprotocol/server-filesystem`,
      },
      {
        title: 'Configure in OpenCode',
        content: 'Add the MCP server to your OpenCode configuration and restart opencode to pick it up:',
        code: `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-filesystem",
        "./"
      ]
    }
  }
}`,
      },
      {
        title: 'Test It Out',
        content: 'Now in OpenCode, try asking: "List the files in the current directory" or "Read the package.json file". The AI will use the filesystem MCP server to access your files safely.',
      }
    ]
  },
  {
    id: 'tut-agents-skills',
    title: 'OpenCode Agents & Skills Deep Dive',
    description: 'Master the three-tier extensibility system: Skills, Agents, and Plugins',
    level: 'intermediate',
    duration: '30 min',
    steps: [
      {
        title: 'Skills — Lightweight Prompts',
        content: 'Skills are markdown files with frontmatter that define agent behavior. They\'re the lightest form of customization. Create a file called `.opencode/skills/reviewer.md` and OpenCode will load it automatically.',
        code: `---
name: code-reviewer
description: Reviews code for quality and security
---

You are a senior code reviewer. Focus on:
- Security vulnerabilities
- Performance issues
- Code style and maintainability`,
      },
      {
        title: 'Agents — Specialized Workers',
        content: 'Agents are specialized workers with their own system prompt and tool permissions. You can define them in your opencode.json or using the `opencode agent create` command. Each agent can have different model, permissions, and behavior.',
      },
      {
        title: 'Plugins — Full Integration',
        content: 'Plugins are npm packages that provide full TypeScript integration with hooks, tools, and event handlers. Agora itself runs as a plugin. Plugins can add custom tools, respond to events, and integrate deeply with OpenCode.',
      }
    ]
  },
  {
    id: 'tut-tdd-workflow',
    title: 'TDD with OpenCode',
    description: 'Use the TDD workflow to drive test-first development with AI assistance',
    level: 'intermediate',
    duration: '20 min',
    steps: [
      {
        title: 'Install the TDD Workflow',
        content: 'Agora comes with a TDD workflow. View it first:',
        code: `agora browse wf-tdd-cycle`,
      },
      {
        title: 'Apply the Workflow',
        content: 'Apply the workflow as an OpenCode skill to use it during development:',
        code: `agora use wf-tdd-cycle`,
      },
      {
        title: 'Start Coding',
        content: 'Now when you ask OpenCode to implement a feature, it will automatically follow TDD — write the test first, implement, then refactor. The structured thinking MCP server helps with the planning phase.',
      }
    ]
  },
  {
    id: 'tut-security-audit',
    title: 'Security Auditing with OpenCode',
    description: 'Run automated security audits using the security workflow and community tools',
    level: 'advanced',
    duration: '25 min',
    steps: [
      {
        title: 'Install Security Tools',
        content: 'First, install the security audit workflow and the necessary MCP servers:',
        code: `agora use wf-security-audit
agora install mcp-github`,
      },
      {
        title: 'Run an Audit',
        content: 'In OpenCode, use the security workflow: "Run a security audit on this project". The agent will check for OWASP Top 10 vulnerabilities, hardcoded secrets, dependency vulnerabilities, and more.',
      },
      {
        title: 'Review Findings',
        content: 'The audit produces a prioritized report with severity levels and suggested fixes. Each finding includes a clear remediation step you can ask OpenCode to implement.',
      }
    ]
  },
  {
    id: 'tut-advanced-mcp',
    title: 'Building Custom MCP Servers',
    description: 'Create your own MCP servers using the TypeScript SDK',
    level: 'advanced',
    duration: '45 min',
    steps: [
      {
        title: 'Prerequisites',
        content: 'Make sure you have the MCP SDK installed and a basic understanding of TypeScript.',
        code: `npm install @modelcontextprotocol/sdk zod`,
      },
      {
        title: 'Create a Basic Server',
        content: 'An MCP server exposes tools, resources, and prompts. Here is a minimal server with one tool:',
        code: `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "My Server", version: "1.0.0" });

server.tool("greet", { name: z.string() }, async ({ name }) => ({
  content: [{ type: "text", text: \`Hello, \${name}!\` }]
}));

// Start with stdio transport
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const transport = new StdioServerTransport();
await server.connect(transport);`,
      },
      {
        title: 'Test Your Server',
        content: 'Run it and test with an MCP inspector or add it to OpenCode:',
        code: `# Run your server
npx tsx src/my-server.ts

# Add to opencode.json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["tsx", "src/my-server.ts"]
    }
  }
}`,
      }
    ]
  },
  {
    id: 'tut-opencode-tips',
    title: 'OpenCode Power User Tips',
    description: 'Advanced tips and workflows for getting the most out of OpenCode',
    level: 'beginner',
    duration: '10 min',
    steps: [
      {
        title: 'Keyboard Shortcuts',
        content: 'Learn the essential keybindings: Tab switches between agents, Ctrl+C interrupts the current action, Ctrl+L clears the conversation, / lists all available commands.',
      },
      {
        title: 'Custom Agents',
        content: 'Create specialized agents for different tasks. For example, a "reviewer" agent with read-only permissions for code review, or a "deploy" agent with access to deployment tools.',
        code: `opencode agent create --name reviewer --mode primary --permissions read,glob,grep`,
      },
      {
        title: 'Session Management',
        content: 'Continue previous sessions with `opencode -c`, fork them with `opencode --fork`, or start a specific agent with `opencode --agent reviewer`. Sessions persist across restarts.',
      }
    ]
  }
];

export const trendingTags = [
  'mcp',
  'workflow',
  'security',
  'testing',
  'refactor',
  'llm',
  'local',
  'productivity',
  'database',
  'devops',
  'frontend',
  'ai',
  'docker',
  'api',
  'observability'
];


