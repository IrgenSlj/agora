import type { Package, Workflow, Discussion, Tutorial } from './types.js';

export const dataRefreshedAt = '2026-05-14';

export const samplePackages: Package[] = [
  // ── Filesystem & Core I/O ──
  {
    id: 'mcp-filesystem',
    name: '@modelcontextprotocol/server-filesystem',
    description:
      'Secure file read/write, directory operations, search, and metadata access with configurable access control',
    author: 'Anthropic, PBC',
    version: '2026.1.14',
    category: 'mcp',
    tags: ['filesystem', 'files', 'io', 'security', 'official'],
    stars: 85625,
    installs: 264237,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-filesystem',
    createdAt: '2024-11-21'
  },
  {
    id: 'mcp-everything',
    name: '@modelcontextprotocol/server-everything',
    description:
      'Reference MCP server exercising every protocol feature — tools, resources, prompts, and sampling',
    author: 'Anthropic, PBC',
    version: '2026.1.26',
    category: 'mcp',
    tags: ['reference', 'testing', 'official', 'mcp'],
    stars: 85625,
    installs: 82229,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-everything',
    createdAt: '2024-11-19'
  },

  // ── Version Control & DevTools ──
  {
    id: 'mcp-github',
    name: '@modelcontextprotocol/server-github',
    description:
      'Full GitHub API integration — issues, PRs, repos, search, file contents, and releases',
    author: 'Anthropic, PBC',
    version: '2025.4.8',
    category: 'mcp',
    tags: ['github', 'git', 'api', 'official', 'devtools'],
    stars: 85625,
    installs: 119750,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-github',
    createdAt: '2024-11-21'
  },
  {
    id: 'mcp-gitlab',
    name: '@modelcontextprotocol/server-gitlab',
    description: 'GitLab API integration — projects, merge requests, issues, and file operations',
    author: 'GitLab, PBC',
    version: '2025.4.25',
    category: 'mcp',
    tags: ['gitlab', 'git', 'api', 'official', 'devtools'],
    stars: 85625,
    installs: 6568,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-gitlab',
    createdAt: '2024-12-04'
  },

  // ── Database Servers ──
  {
    id: 'mcp-postgres',
    name: '@modelcontextprotocol/server-postgres',
    description: 'Read-only PostgreSQL database access — schema inspection and SQL query execution',
    author: 'Anthropic, PBC',
    version: '0.6.2',
    category: 'mcp',
    tags: ['postgresql', 'database', 'sql', 'official', 'data'],
    stars: 85625,
    installs: 182440,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-postgres',
    createdAt: '2024-11-19'
  },
  {
    id: 'mcp-redis',
    name: '@modelcontextprotocol/server-redis',
    description: 'Redis key-value store operations — get/set, list management, and cache control',
    author: 'Anthropic, PBC',
    version: '2025.4.25',
    category: 'mcp',
    tags: ['redis', 'cache', 'database', 'official', 'data'],
    stars: 85625,
    installs: 2888,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-redis',
    createdAt: '2025-04-07'
  },
  {
    id: 'mcp-mongodb',
    name: 'mongodb-mcp-server',
    description:
      'MongoDB and Atlas integration — document queries, aggregation pipelines, and cluster management',
    author: 'mongodb-js',
    version: '1.10.0',
    category: 'mcp',
    tags: ['mongodb', 'database', 'nosql', 'data'],
    stars: 1021,
    installs: 51183,
    repository: 'https://github.com/mongodb-js/mongodb-mcp-server',
    npmPackage: 'mongodb-mcp-server',
    createdAt: '2025-04-23'
  },
  {
    id: 'mcp-elasticsearch',
    name: '@elastic/mcp-server-elasticsearch',
    description: 'Elasticsearch integration — search, indexing, and cluster query management',
    author: 'Elastic',
    version: '0.3.1',
    category: 'mcp',
    tags: ['elasticsearch', 'search', 'analytics', 'data'],
    stars: 658,
    installs: 1007,
    repository: 'https://github.com/elastic/mcp-server-elasticsearch',
    npmPackage: '@elastic/mcp-server-elasticsearch',
    createdAt: '2025-03-24'
  },
  {
    id: 'mcp-supabase',
    name: '@supabase/mcp-server-supabase',
    description: 'Supabase project management — database, auth, storage, and edge functions',
    author: 'supabase-community',
    version: '0.8.1',
    category: 'mcp',
    tags: ['supabase', 'database', 'backend', 'baas'],
    stars: 2684,
    installs: 68083,
    repository: 'https://github.com/supabase-community/supabase-mcp',
    npmPackage: '@supabase/mcp-server-supabase',
    createdAt: '2025-03-28'
  },

  // ── AI & Memory ──
  {
    id: 'mcp-sequential-thinking',
    name: '@modelcontextprotocol/server-sequential-thinking',
    description: 'Structured multi-step reasoning with branching, revision, and chain-of-thought',
    author: 'Anthropic, PBC',
    version: '2025.12.18',
    category: 'mcp',
    tags: ['reasoning', 'thinking', 'ai', 'official'],
    stars: 85625,
    installs: 105931,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-sequential-thinking',
    createdAt: '2024-12-03'
  },
  {
    id: 'mcp-memory',
    name: '@modelcontextprotocol/server-memory',
    description: 'Persistent knowledge graph memory for cross-session context retention',
    author: 'Anthropic, PBC',
    version: '2026.1.26',
    category: 'mcp',
    tags: ['memory', 'knowledge-graph', 'persistence', 'official'],
    stars: 85625,
    installs: 73433,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-memory',
    createdAt: '2024-11-21'
  },
  {
    id: 'mcp-context7',
    name: '@upstash/context7-mcp',
    description: 'Up-to-date, version-specific documentation and code examples for any library',
    author: 'upstash',
    version: '2.2.5',
    category: 'mcp',
    tags: ['documentation', 'context', 'ai', 'reference'],
    stars: 55284,
    installs: 1141616,
    repository: 'https://github.com/upstash/context7',
    npmPackage: '@upstash/context7-mcp',
    createdAt: '2025-04-08'
  },

  // ── Search & Web ──
  {
    id: 'mcp-brave-search',
    name: '@modelcontextprotocol/server-brave-search',
    description: 'Web search and local business queries using the Brave Search API',
    author: 'Anthropic, PBC',
    version: '0.6.2',
    category: 'mcp',
    tags: ['search', 'web', 'brave', 'api', 'official'],
    stars: 85625,
    installs: 24941,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-brave-search',
    createdAt: '2024-11-21'
  },
  {
    id: 'mcp-tavily',
    name: 'tavily-mcp',
    description: 'AI-optimized web search and content extraction with the Tavily API',
    author: 'Tavily',
    version: '0.2.19',
    category: 'mcp',
    tags: ['search', 'web', 'ai', 'tavily'],
    stars: 1965,
    installs: 28859,
    repository: 'https://github.com/tavily-ai/tavily-mcp',
    npmPackage: 'tavily-mcp',
    createdAt: '2025-01-27'
  },
  {
    id: 'mcp-exa',
    name: 'exa-mcp-server',
    description: 'Exa AI search — web search, research, and content discovery for LLM contexts',
    author: 'Exa Labs',
    version: '3.2.1',
    category: 'mcp',
    tags: ['search', 'web', 'ai', 'research'],
    stars: 4425,
    installs: 12842,
    repository: 'https://github.com/exa-labs/exa-mcp-server',
    npmPackage: 'exa-mcp-server',
    createdAt: '2024-12-17'
  },
  {
    id: 'mcp-perplexity',
    name: 'server-perplexity-ask',
    description: 'Real-time web-wide research and Q&A through the Perplexity Sonar API',
    author: 'Model Context Protocol',
    version: '0.1.3',
    category: 'mcp',
    tags: ['search', 'web', 'ai', 'research'],
    stars: 85625,
    installs: 1452,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: 'server-perplexity-ask',
    createdAt: '2025-02-19'
  },
  {
    id: 'mcp-firecrawl',
    name: 'firecrawl-mcp',
    description: 'Web scraping with JavaScript rendering, crawling, and markdown extraction',
    author: 'firecrawl',
    version: '3.15.0',
    category: 'mcp',
    tags: ['scraping', 'web', 'crawl', 'markdown'],
    stars: 6308,
    installs: 54574,
    repository: 'https://github.com/firecrawl/firecrawl-mcp-server',
    npmPackage: 'firecrawl-mcp',
    createdAt: '2025-02-21'
  },
  {
    id: 'mcp-google-maps',
    name: '@modelcontextprotocol/server-google-maps',
    description: 'Google Maps integration — geocoding, places, directions, and distance queries',
    author: 'Anthropic, PBC',
    version: '0.6.2',
    category: 'mcp',
    tags: ['maps', 'geocoding', 'location', 'official'],
    stars: 85625,
    installs: 10487,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-google-maps',
    createdAt: '2024-11-21'
  },

  // ── Browser Automation ──
  {
    id: 'mcp-puppeteer',
    name: '@modelcontextprotocol/server-puppeteer',
    description:
      'Headless Chrome browser automation — navigation, screenshots, and JavaScript evaluation',
    author: 'Anthropic, PBC',
    version: '2025.5.12',
    category: 'mcp',
    tags: ['browser', 'automation', 'puppeteer', 'official', 'web'],
    stars: 85625,
    installs: 29680,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-puppeteer',
    createdAt: '2024-11-19'
  },
  {
    id: 'mcp-playwright',
    name: '@playwright/mcp',
    description:
      'Official Playwright browser automation — accessibility-tree navigation, multi-page, and network control',
    author: 'Microsoft Corporation',
    version: '0.0.75',
    category: 'mcp',
    tags: ['browser', 'automation', 'playwright', 'testing', 'web'],
    stars: 32493,
    installs: 2613994,
    repository: 'https://github.com/microsoft/playwright-mcp',
    npmPackage: '@playwright/mcp',
    createdAt: '2025-03-13'
  },
  {
    id: 'mcp-playwright-ea',
    name: '@executeautomation/playwright-mcp-server',
    description: 'Playwright automation and test code generation — browser control and scraping',
    author: 'ExecuteAutomation, Ltd',
    version: '1.0.12',
    category: 'mcp',
    tags: ['browser', 'automation', 'playwright', 'testing'],
    stars: 5510,
    installs: 79058,
    repository: 'https://github.com/executeautomation/mcp-playwright',
    npmPackage: '@executeautomation/playwright-mcp-server',
    createdAt: '2024-12-05'
  },
  {
    id: 'mcp-browsermcp',
    name: '@browsermcp/mcp',
    description: 'Automate your own browser — control your real Chrome profile, tabs, and sessions',
    author: 'Browser MCP',
    version: '0.1.3',
    category: 'mcp',
    tags: ['browser', 'automation', 'web'],
    stars: 0,
    installs: 7461,
    npmPackage: '@browsermcp/mcp',
    createdAt: '2025-04-05'
  },

  // ── Communication & Productivity ──
  {
    id: 'mcp-slack',
    name: '@modelcontextprotocol/server-slack',
    description: 'Slack workspace integration — messaging, channel management, and user presence',
    author: 'Anthropic, PBC',
    version: '2025.4.25',
    category: 'mcp',
    tags: ['slack', 'communication', 'messaging', 'official'],
    stars: 85625,
    installs: 62239,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-slack',
    createdAt: '2024-11-19'
  },
  {
    id: 'mcp-notion',
    name: '@notionhq/notion-mcp-server',
    description: 'Official Notion integration — pages, databases, search, and content management',
    author: 'notionhq',
    version: '2.2.1',
    category: 'mcp',
    tags: ['notion', 'documentation', 'knowledge-base'],
    stars: 4327,
    installs: 67119,
    repository: 'https://github.com/makenotion/notion-mcp-server',
    npmPackage: '@notionhq/notion-mcp-server',
    createdAt: '2025-04-03'
  },
  {
    id: 'mcp-gdrive',
    name: '@modelcontextprotocol/server-gdrive',
    description: 'Google Drive integration — list, search, and read files across a Drive account',
    author: 'Anthropic, PBC',
    version: '2025.1.14',
    category: 'mcp',
    tags: ['google-drive', 'files', 'documents', 'official'],
    stars: 85625,
    installs: 8678,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-gdrive',
    createdAt: '2024-11-19'
  },

  // ── Design & Frontend ──
  {
    id: 'mcp-figma',
    name: 'figma-developer-mcp',
    description:
      'Figma layout and design data for AI coding agents — convert designs to code accurately',
    author: 'GLips',
    version: '0.11.0',
    category: 'mcp',
    tags: ['figma', 'design', 'design-tokens', 'frontend'],
    stars: 14747,
    installs: 53549,
    repository: 'https://github.com/GLips/Figma-Context-MCP',
    npmPackage: 'figma-developer-mcp',
    createdAt: '2025-02-22'
  },
  {
    id: 'mcp-magic',
    name: '@21st-dev/magic',
    description: 'Generate polished React UI components from natural language with 21st.dev Magic',
    author: '21st-dev',
    version: '0.1.0',
    category: 'mcp',
    tags: ['ui', 'components', 'react', 'frontend', 'design'],
    stars: 4863,
    installs: 11231,
    repository: 'https://github.com/21st-dev/magic-mcp',
    npmPackage: '@21st-dev/magic',
    createdAt: '2025-03-11'
  },

  // ── Cloud, Infra & DevOps ──
  {
    id: 'mcp-cloudflare',
    name: '@cloudflare/mcp-server-cloudflare',
    description: 'Cloudflare API — Workers, KV, R2, D1, DNS, and account management',
    author: 'Cloudflare, Inc.',
    version: '0.2.0',
    category: 'mcp',
    tags: ['cloudflare', 'dns', 'workers', 'infrastructure', 'devops'],
    stars: 0,
    installs: 2249,
    npmPackage: '@cloudflare/mcp-server-cloudflare',
    createdAt: '2024-11-27'
  },
  {
    id: 'mcp-kubernetes',
    name: 'mcp-server-kubernetes',
    description: 'Kubernetes cluster management — pods, deployments, services, logs, and Helm',
    author: 'Flux159',
    version: '3.5.1',
    category: 'mcp',
    tags: ['kubernetes', 'k8s', 'containers', 'infrastructure', 'devops'],
    stars: 1391,
    installs: 13585,
    repository: 'https://github.com/Flux159/mcp-server-kubernetes',
    npmPackage: 'mcp-server-kubernetes',
    createdAt: '2024-12-10'
  },
  {
    id: 'mcp-heroku',
    name: '@heroku/mcp-server',
    description: 'Heroku platform management — apps, dynos, add-ons, releases, and config vars',
    author: 'Heroku',
    version: '1.2.2',
    category: 'mcp',
    tags: ['heroku', 'paas', 'deployment', 'devops'],
    stars: 76,
    installs: 5693,
    repository: 'https://github.com/heroku/heroku-mcp-server',
    npmPackage: '@heroku/mcp-server',
    createdAt: '2025-04-07'
  },
  {
    id: 'mcp-aws-kb',
    name: '@modelcontextprotocol/server-aws-kb-retrieval',
    description: 'Retrieve documents from an AWS Knowledge Base via Bedrock Agent Runtime',
    author: 'Anthropic, PBC',
    version: '0.6.2',
    category: 'mcp',
    tags: ['aws', 'bedrock', 'retrieval', 'cloud', 'official'],
    stars: 85625,
    installs: 403,
    repository: 'https://github.com/modelcontextprotocol/servers',
    npmPackage: '@modelcontextprotocol/server-aws-kb-retrieval',
    createdAt: '2025-01-14'
  },
  {
    id: 'mcp-remote',
    name: 'mcp-remote',
    description: 'Adapter that connects local stdio MCP clients to remote HTTP/SSE MCP servers',
    author: 'Glen Maddern',
    version: '0.1.38',
    category: 'mcp',
    tags: ['proxy', 'remote', 'transport', 'infrastructure'],
    stars: 1423,
    installs: 354615,
    repository: 'https://github.com/geelen/mcp-remote',
    npmPackage: 'mcp-remote',
    createdAt: '2025-03-17'
  },

  // ── Monitoring & Payments ──
  {
    id: 'mcp-sentry',
    name: '@sentry/mcp-server',
    description: 'Sentry error tracking — issues, events, releases, and performance monitoring',
    author: 'getsentry',
    version: '0.33.0',
    category: 'mcp',
    tags: ['sentry', 'monitoring', 'errors', 'observability'],
    stars: 687,
    installs: 90109,
    repository: 'https://github.com/getsentry/sentry-mcp',
    npmPackage: '@sentry/mcp-server',
    createdAt: '2025-04-24'
  },
  {
    id: 'mcp-stripe',
    name: '@stripe/mcp',
    description: 'Stripe payments — customers, products, prices, invoices, and payment links',
    author: 'Stripe',
    version: '0.3.3',
    category: 'mcp',
    tags: ['stripe', 'payments', 'billing', 'commerce'],
    stars: 1548,
    installs: 22628,
    repository: 'https://github.com/stripe/ai',
    npmPackage: '@stripe/mcp',
    createdAt: '2025-02-19'
  },

  // ── Prompts ──
  {
    id: 'prompt-code-review',
    name: 'Comprehensive Code Review',
    description:
      'Multi-faceted code review covering security, performance, correctness, and best practices',
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
    description:
      'Review REST/GraphQL API designs for consistency, scalability, and developer experience',
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
  }
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
    description:
      'Thorough security analysis covering OWASP Top 10, secrets, and dependency vulnerabilities',
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
    description:
      'Review API endpoints for RESTful best practices, consistency, and developer experience',
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

// Discussions are backend-only. The offline build ships none rather than
// fabricated community activity — real threads are served live when
// AGORA_API_URL points at a deployed backend.
export const sampleDiscussions: Discussion[] = [];

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
        content:
          "The Model Context Protocol (MCP) is an open standard that lets AI models connect with external tools and data sources. Think of it as a USB-C port for AI — a universal way to plug any AI into any tool. MCP was created by Anthropic and is now governed by the Linux Foundation's Agentic AI Foundation."
      },
      {
        title: 'Installing Your First MCP Server',
        content:
          "Let's install the filesystem MCP server. OpenCode uses MCP servers to access your files, run commands, and interact with APIs.",
        code: `npm install -g @modelcontextprotocol/server-filesystem`
      },
      {
        title: 'Configure in OpenCode',
        content:
          'Add the MCP server to your OpenCode configuration and restart opencode to pick it up:',
        code: `{
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "@modelcontextprotocol/server-filesystem", "./"]
    }
  }
}`
      },
      {
        title: 'Test It Out',
        content:
          'Now in OpenCode, try asking: "List the files in the current directory" or "Read the package.json file". The AI will use the filesystem MCP server to access your files safely.'
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
        content:
          "Skills are markdown files with frontmatter that define agent behavior. They're the lightest form of customization. Create a file called `.opencode/skills/reviewer.md` and OpenCode will load it automatically.",
        code: `---
name: code-reviewer
description: Reviews code for quality and security
---

You are a senior code reviewer. Focus on:
- Security vulnerabilities
- Performance issues
- Code style and maintainability`
      },
      {
        title: 'Agents — Specialized Workers',
        content:
          'Agents are specialized workers with their own system prompt and tool permissions. You can define them in your opencode.json or using the `opencode agent create` command. Each agent can have different model, permissions, and behavior.'
      },
      {
        title: 'Plugins — Full Integration',
        content:
          'Plugins are npm packages that provide full TypeScript integration with hooks, tools, and event handlers. Agora itself runs as a plugin. Plugins can add custom tools, respond to events, and integrate deeply with OpenCode.'
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
        code: `agora browse wf-tdd-cycle`
      },
      {
        title: 'Apply the Workflow',
        content: 'Apply the workflow as an OpenCode skill to use it during development:',
        code: `agora use wf-tdd-cycle`
      },
      {
        title: 'Start Coding',
        content:
          'Now when you ask OpenCode to implement a feature, it will automatically follow TDD — write the test first, implement, then refactor. The structured thinking MCP server helps with the planning phase.'
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
agora install mcp-github`
      },
      {
        title: 'Run an Audit',
        content:
          'In OpenCode, use the security workflow: "Run a security audit on this project". The agent will check for OWASP Top 10 vulnerabilities, hardcoded secrets, dependency vulnerabilities, and more.'
      },
      {
        title: 'Review Findings',
        content:
          'The audit produces a prioritized report with severity levels and suggested fixes. Each finding includes a clear remediation step you can ask OpenCode to implement.'
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
        content:
          'Make sure you have the MCP SDK installed and a basic understanding of TypeScript.',
        code: `npm install @modelcontextprotocol/sdk zod`
      },
      {
        title: 'Create a Basic Server',
        content:
          'An MCP server exposes tools, resources, and prompts. Here is a minimal server with one tool:',
        code: `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "My Server", version: "1.0.0" });

server.tool("greet", { name: z.string() }, async ({ name }) => ({
  content: [{ type: "text", text: \`Hello, \${name}!\` }]
}));

// Start with stdio transport
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const transport = new StdioServerTransport();
await server.connect(transport);`
      },
      {
        title: 'Test Your Server',
        content: 'Run it and test with an MCP inspector or add it to OpenCode:',
        code: `# Run your server
npx tsx src/my-server.ts

# Add to opencode.json
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["npx", "tsx", "src/my-server.ts"]
    }
  }
}`
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
        content:
          'Learn the essential keybindings: Tab switches between agents, Ctrl+C interrupts the current action, Ctrl+L clears the conversation, / lists all available commands.'
      },
      {
        title: 'Custom Agents',
        content:
          'Create specialized agents for different tasks. For example, a "reviewer" agent with read-only permissions for code review, or a "deploy" agent with access to deployment tools.',
        code: `opencode agent create --name reviewer --mode primary --permissions read,glob,grep`
      },
      {
        title: 'Session Management',
        content:
          'Continue previous sessions with `opencode -c`, fork them with `opencode --fork`, or start a specific agent with `opencode --agent reviewer`. Sessions persist across restarts.'
      }
    ]
  }
];

export const trendingTags = [
  'mcp',
  'official',
  'database',
  'search',
  'web',
  'ai',
  'devops',
  'browser',
  'automation',
  'infrastructure',
  'frontend',
  'workflow',
  'security',
  'testing',
  'api'
];
