import type { Package, Workflow, Discussion, Tutorial } from './types.js';

export const dataRefreshedAt = '2026-05-15';

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
    createdAt: '2024-11-21',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-11-19',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-11-21',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-12-04',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-11-19',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-04-07',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-04-23',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-03-24',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-03-28',
    pricing: { kind: 'free' as const }
  },

  // ── AI & Memory ──
  {
    id: 'mcp-openai',
    name: 'openai-mcp-server',
    description: 'OpenAI API — GPT completions, embeddings, assistants, and file management',
    author: 'openai',
    version: '1.3.0',
    category: 'mcp',
    tags: ['openai', 'ai', 'llm', 'api', 'completions'],
    stars: 12350,
    installs: 345890,
    repository: 'https://github.com/openai/openai-mcp-server',
    npmPackage: 'openai-mcp-server',
    createdAt: '2025-01-15',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-anthropic',
    name: '@anthropic/mcp-server',
    description: 'Anthropic Claude API — completions, messages, and tool use integration',
    author: 'Anthropic, PBC',
    version: '0.4.1',
    category: 'mcp',
    tags: ['anthropic', 'claude', 'ai', 'llm', 'api'],
    stars: 5678,
    installs: 289000,
    repository: 'https://github.com/anthropics/anthropic-mcp-server',
    createdAt: '2025-04-01',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-replicate',
    name: 'replicate-mcp-server',
    description: 'Run ML models via Replicate API — image generation, LLMs, audio, and video',
    author: 'Replicate',
    version: '0.3.0',
    category: 'mcp',
    tags: ['replicate', 'ai', 'ml', 'models', 'api'],
    stars: 1234,
    installs: 34560,
    repository: 'https://github.com/replicate/replicate-mcp-server',
    npmPackage: 'replicate-mcp',
    createdAt: '2025-02-10',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-huggingface',
    name: 'hf-mcp-server',
    description: 'Hugging Face inference API — text generation, embeddings, and model discovery',
    author: 'huggingface',
    version: '0.5.0',
    category: 'mcp',
    tags: ['huggingface', 'ai', 'transformers', 'api'],
    stars: 2340,
    installs: 56780,
    repository: 'https://github.com/huggingface/hf-mcp-server',
    createdAt: '2025-03-05',
    pricing: { kind: 'free' as const }
  },
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
    createdAt: '2024-12-03',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-11-21',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-04-08',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-11-21',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-01-27',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-12-17',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-02-19',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-02-21',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-11-21',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-11-19',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-03-13',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-12-05',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-04-05',
    pricing: { kind: 'free' as const }
  },

  // ── Project Management ──
  {
    id: 'mcp-linear',
    name: '@linear/mcp-server',
    description:
      'Linear issue tracking — create and update issues, search projects, manage sprints',
    author: 'Linear',
    version: '1.1.0',
    category: 'mcp',
    tags: ['linear', 'project-management', 'issues', 'sprints'],
    stars: 6543,
    installs: 189000,
    repository: 'https://github.com/linear/linear-mcp-server',
    createdAt: '2025-02-25',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-jira',
    name: 'jira-mcp-server',
    description:
      'Jira and Confluence — issue creation, search, project management, and wiki access',
    author: 'atlassian-labs',
    version: '0.9.0',
    category: 'mcp',
    tags: ['jira', 'confluence', 'atlassian', 'project-management'],
    stars: 3200,
    installs: 98700,
    repository: 'https://github.com/atlassian-labs/jira-mcp-server',
    npmPackage: 'jira-mcp-server',
    createdAt: '2025-03-01',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-asana',
    name: 'asana-mcp-server',
    description: 'Asana task and project management — tasks, projects, teams, and portfolio views',
    author: 'asana-community',
    version: '0.4.0',
    category: 'mcp',
    tags: ['asana', 'project-management', 'tasks'],
    stars: 450,
    installs: 12300,
    repository: 'https://github.com/asana-community/asana-mcp-server',
    createdAt: '2025-04-10',
    pricing: { kind: 'free' as const }
  },

  // ── Knowledge & Notes ──
  {
    id: 'mcp-obsidian',
    name: 'obsidian-mcp-server',
    description:
      'Obsidian vault access — read, search, and create notes across your knowledge base',
    author: 'obsidian-mcp',
    version: '1.5.0',
    category: 'mcp',
    tags: ['obsidian', 'notes', 'knowledge', 'markdown'],
    stars: 9800,
    installs: 345000,
    repository: 'https://github.com/obsidian-mcp/obsidian-mcp-server',
    npmPackage: 'obsidian-mcp-server',
    createdAt: '2025-01-25',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-confluence',
    name: 'confluence-mcp-server',
    description:
      'Confluence wiki — pages, search, spaces, and content management for documentation',
    author: 'atlassian-labs',
    version: '0.3.0',
    category: 'mcp',
    tags: ['confluence', 'wiki', 'documentation', 'knowledge'],
    stars: 890,
    installs: 23400,
    repository: 'https://github.com/atlassian-labs/confluence-mcp-server',
    npmPackage: 'confluence-mcp-server',
    createdAt: '2025-04-05',
    pricing: { kind: 'free' as const }
  },

  // ── Development Tools ──
  {
    id: 'mcp-sonarqube',
    name: '@sonarsource/mcp-server-sonarqube',
    description: 'SonarQube code quality — issues, metrics, quality gates, and project analysis',
    author: 'SonarSource',
    version: '0.5.0',
    category: 'mcp',
    tags: ['sonarqube', 'code-quality', 'linting', 'static-analysis'],
    stars: 560,
    installs: 18900,
    repository: 'https://github.com/SonarSource/sonarqube-mcp-server',
    createdAt: '2025-03-20',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-snyk',
    name: 'snyk-mcp-server',
    description:
      'Snyk vulnerability scanning — dependency checks, container scanning, and IaC analysis',
    author: 'snyk-labs',
    version: '0.3.0',
    category: 'mcp',
    tags: ['snyk', 'security', 'vulnerability', 'dependencies'],
    stars: 780,
    installs: 34500,
    repository: 'https://github.com/snyk-labs/snyk-mcp-server',
    createdAt: '2025-04-15',
    pricing: { kind: 'free' as const }
  },

  // ── Cloud Platforms ──
  {
    id: 'mcp-aws',
    name: '@aws/mcp-server-aws',
    description: 'AWS cloud management — EC2, S3, Lambda, IAM, and cost management across services',
    author: 'Amazon Web Services',
    version: '0.6.0',
    category: 'mcp',
    tags: ['aws', 'cloud', 'ec2', 's3', 'lambda', 'infrastructure'],
    stars: 4500,
    installs: 156000,
    repository: 'https://github.com/awslabs/aws-mcp-server',
    createdAt: '2025-02-01',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-vercel',
    name: '@vercel/mcp-server',
    description:
      'Vercel deployment management — projects, deployments, domains, and environment variables',
    author: 'Vercel',
    version: '0.4.0',
    category: 'mcp',
    tags: ['vercel', 'deployment', 'frontend', 'hosting'],
    stars: 3400,
    installs: 89000,
    repository: 'https://github.com/vercel/vercel-mcp-server',
    createdAt: '2025-03-01',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-netlify',
    name: '@netlify/mcp-server',
    description:
      'Netlify deployment management — sites, deploys, functions, and environment config',
    author: 'Netlify',
    version: '0.3.0',
    category: 'mcp',
    tags: ['netlify', 'deployment', 'hosting', 'jamstack'],
    stars: 890,
    installs: 23400,
    repository: 'https://github.com/netlify/netlify-mcp-server',
    npmPackage: '@netlify/mcp',
    createdAt: '2025-04-01',
    pricing: { kind: 'free' as const }
  },

  // ── Communication & Community ──
  {
    id: 'mcp-discord',
    name: 'discord-mcp-server',
    description: 'Discord integration — messages, channels, server management, and webhook control',
    author: 'discord-community',
    version: '0.6.0',
    category: 'mcp',
    tags: ['discord', 'chat', 'community', 'messaging'],
    stars: 3456,
    installs: 98700,
    repository: 'https://github.com/discord-community/discord-mcp-server',
    npmPackage: 'discord-mcp-server',
    createdAt: '2025-03-05',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-email',
    name: '@sendgrid/mcp-server',
    description:
      'Email delivery via SendGrid — send transactional emails, manage templates, and analytics',
    author: 'sendgrid-community',
    version: '0.3.0',
    category: 'mcp',
    tags: ['email', 'sendgrid', 'communication', 'notifications'],
    stars: 450,
    installs: 23400,
    repository: 'https://github.com/sendgrid-community/sendgrid-mcp-server',
    npmPackage: 'sendgrid-mcp',
    createdAt: '2025-04-15',
    pricing: { kind: 'free' as const }
  },

  // ── Productivity & Office ──
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
    createdAt: '2024-11-19',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-04-03',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-11-19',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-02-22',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-03-11',
    pricing: { kind: 'free' as const }
  },

  // ── Containers & Virtualisation ──
  {
    id: 'mcp-docker',
    name: 'mcp-docker-server',
    description: 'Docker container management — images, containers, compose, logs, and exec',
    author: 'docker-labs',
    version: '1.2.0',
    category: 'mcp',
    tags: ['docker', 'containers', 'devops', 'infrastructure'],
    stars: 8456,
    installs: 234500,
    repository: 'https://github.com/docker-labs/mcp-docker-server',
    npmPackage: 'mcp-docker-server',
    createdAt: '2025-01-20',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-sqlite',
    name: '@sqlite/mcp-server',
    description: 'SQLite database management — queries, schema inspection, and data migration',
    author: 'sqlite-community',
    version: '0.8.2',
    category: 'mcp',
    tags: ['sqlite', 'database', 'sql', 'data'],
    stars: 3200,
    installs: 128000,
    repository: 'https://github.com/sqlite-community/sqlite-mcp',
    npmPackage: '@easy-mcps/sqlite-mcp-server',
    createdAt: '2025-02-15',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-pinecone',
    name: 'pinecone-mcp-server',
    description: 'Pinecone vector database — index management, upsert, query, and namespace ops',
    author: 'pinecone-io',
    version: '0.4.0',
    category: 'mcp',
    tags: ['pinecone', 'vector', 'database', 'ai', 'embeddings'],
    stars: 890,
    installs: 23450,
    repository: 'https://github.com/pinecone-io/pinecone-mcp-server',
    npmPackage: 'pinecone-mcp',
    createdAt: '2025-03-10',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-qdrant',
    name: 'qdrant-mcp-server',
    description: 'Qdrant vector search — collection management, point operations, and filtering',
    author: 'qdrant',
    version: '0.6.0',
    category: 'mcp',
    tags: ['qdrant', 'vector', 'database', 'search', 'ai'],
    stars: 670,
    installs: 18900,
    repository: 'https://github.com/qdrant/qdrant-mcp-server',
    npmPackage: 'qdrant-mcp-server',
    createdAt: '2025-03-15',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-chromadb',
    name: 'chromadb-mcp-server',
    description: 'ChromaDB vector store — collections, document embeddings, and similarity search',
    author: 'chroma-core',
    version: '0.3.1',
    category: 'mcp',
    tags: ['chromadb', 'vector', 'database', 'embeddings', 'ai'],
    stars: 1560,
    installs: 45600,
    repository: 'https://github.com/chroma-core/chromadb-mcp-server',
    npmPackage: 'chromadb-mcp',
    createdAt: '2025-04-01',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-neo4j',
    name: 'neo4j-mcp-server',
    description: 'Neo4j graph database — Cypher queries, schema management, and graph analytics',
    author: 'neo4j',
    version: '0.5.0',
    category: 'mcp',
    tags: ['neo4j', 'graph', 'database', 'cypher'],
    stars: 2100,
    installs: 56700,
    repository: 'https://github.com/neo4j/neo4j-mcp-server',
    createdAt: '2025-02-20',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-11-27',
    pricing: { kind: 'free' as const }
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
    createdAt: '2024-12-10',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-04-07',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-01-14',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-03-17',
    pricing: { kind: 'free' as const }
  },

  // ── Monitoring & Observability ──
  {
    id: 'mcp-datadog',
    name: '@datadog/mcp-server',
    description: 'Datadog monitoring — dashboards, monitors, logs, traces, and incident management',
    author: 'DataDog',
    version: '0.5.0',
    category: 'mcp',
    tags: ['datadog', 'monitoring', 'observability', 'apm'],
    stars: 1200,
    installs: 45600,
    repository: 'https://github.com/DataDog/datadog-mcp-server',
    npmPackage: 'datadog-mcp',
    createdAt: '2025-03-10',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-grafana',
    name: 'grafana-mcp-server',
    description:
      'Grafana dashboards — query metrics, manage alerts, and explore observability data',
    author: 'grafana-community',
    version: '0.4.0',
    category: 'mcp',
    tags: ['grafana', 'monitoring', 'dashboards', 'observability'],
    stars: 2340,
    installs: 67800,
    repository: 'https://github.com/grafana-community/grafana-mcp-server',
    createdAt: '2025-02-20',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-pagerduty',
    name: 'pagerduty-mcp-server',
    description:
      'PagerDuty incident management — incidents, on-call schedules, and escalation policies',
    author: 'PagerDuty',
    version: '0.3.5',
    category: 'mcp',
    tags: ['pagerduty', 'incidents', 'on-call', 'alerting'],
    stars: 560,
    installs: 18900,
    repository: 'https://github.com/PagerDuty/pagerduty-mcp-server',
    createdAt: '2025-04-01',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'mcp-newrelic',
    name: '@newrelic/mcp-server',
    description:
      'New Relic observability — APM, infrastructure, logs, and query NRQL across services',
    author: 'New Relic',
    version: '0.3.0',
    category: 'mcp',
    tags: ['newrelic', 'apm', 'observability', 'monitoring'],
    stars: 340,
    installs: 12300,
    repository: 'https://github.com/newrelic/newrelic-mcp-server',
    createdAt: '2025-04-10',
    pricing: { kind: 'free' as const }
  },

  // ── Payments & Commerce ──
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
    createdAt: '2025-04-24',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-02-19',
    pricing: { kind: 'free' as const }
  },

  {
    id: 'mcp-sequelize',
    name: '@anthropic/mcp-server-sequelize',
    description: 'Sequelize ORM integration — model management, migrations, query inspection',
    author: 'Anthropic, PBC',
    version: '0.1.0',
    category: 'mcp',
    tags: ['database', 'sequelize', 'orm', 'sql'],
    stars: 2840,
    installs: 12400,
    repository: 'https://github.com/modelcontextprotocol/servers',
    createdAt: '2025-03-10',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-01-10',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-02-20',
    pricing: { kind: 'free' as const }
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
    createdAt: '2025-03-01',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'prompt-debug-session',
    name: 'Structured Debugging',
    description:
      'Systematic root-cause analysis — form hypotheses, gather evidence, identify the bug',
    author: 'agora-community',
    version: '1.0.0',
    category: 'prompt',
    tags: ['debug', 'root-cause', 'analysis', 'troubleshooting'],
    stars: 920,
    installs: 6200,
    createdAt: '2025-04-10',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'prompt-test-strategy',
    name: 'Test Strategy Planner',
    description:
      'Design a comprehensive testing strategy covering unit, integration, e2e, and property-based tests',
    author: 'agora-community',
    version: '1.0.0',
    category: 'prompt',
    tags: ['testing', 'strategy', 'quality', 'coverage'],
    stars: 410,
    installs: 2100,
    createdAt: '2025-04-20',
    pricing: { kind: 'free' as const }
  },
  {
    id: 'prompt-migration-plan',
    name: 'Migration Plan Generator',
    description:
      'Plan safe, phased migrations — framework upgrades, database migrations, cloud provider moves',
    author: 'agora-community',
    version: '1.0.0',
    category: 'prompt',
    tags: ['migration', 'planning', 'safety', 'rollback'],
    stars: 340,
    installs: 1800,
    createdAt: '2025-05-01',
    pricing: { kind: 'free' as const }
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
    id: 'wf-doc-generator',
    name: 'Documentation Generator',
    description:
      'Generate comprehensive documentation for codebases — API docs, README, and inline comments',
    author: 'doc-master',
    prompt: `Generate thorough documentation for the codebase:
1. Create or update README with setup, usage, and architecture
2. Document all public APIs with parameter descriptions
3. Add inline code comments for complex logic
4. Generate API reference docs from TypeScript types
5. Create changelog from git history
6. Add contributing guide
7. Document environment variables and configuration

Focus on clarity and completeness. The docs should help new contributors onboard quickly.`,
    tags: ['documentation', 'readme', 'api-docs', 'onboarding'],
    stars: 245,
    forks: 38,
    createdAt: '2025-04-05'
  },
  {
    id: 'wf-postmortem',
    name: 'Incident Post-Mortem',
    description: 'Structured incident analysis — timeline, root cause, impact, and action items',
    author: 'sre-team',
    prompt: `Conduct a blameless post-mortem analysis:
1. Establish incident timeline from logs and metrics
2. Identify root cause and contributing factors
3. Document impact (users affected, downtime duration, data loss)
4. Analyze detection and response time
5. Identify systemic issues beyond the immediate cause
6. Propose specific action items with owners
7. Define monitoring to detect recurrence

The goal is learning, not blame. Every action item should be specific and testable.`,
    tags: ['postmortem', 'incident', 'sre', 'analysis'],
    stars: 189,
    forks: 45,
    createdAt: '2025-04-20'
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
    id: 'tut-docker-dev',
    title: 'Docker Development with MCP',
    description: 'Manage Docker containers, images, and compose files from your AI assistant',
    level: 'intermediate',
    duration: '20 min',
    steps: [
      {
        title: 'Install the Docker MCP Server',
        content:
          'First, install the Docker MCP server globally. This lets your AI assistant manage containers.',
        code: `npm install -g mcp-docker-server`
      },
      {
        title: 'Configure in OpenCode',
        content: 'Add the Docker MCP server to your opencode.json:',
        code: `{
  "mcp": {
    "docker": {
      "type": "local",
      "command": ["npx", "mcp-docker-server"]
    }
  }
}`
      },
      {
        title: 'Common Docker Tasks',
        content:
          'Now you can ask your AI to: list running containers, view logs, restart services, build images, manage Docker Compose, and clean up unused resources — all from your terminal via natural language.'
      }
    ]
  },
  {
    id: 'tut-api-testing',
    title: 'API Testing with MCP Tools',
    description: 'Learn to test and debug APIs using MCP servers and OpenCode workflows',
    level: 'beginner',
    duration: '15 min',
    steps: [
      {
        title: 'Set Up API Testing Tools',
        content:
          'Install the necessary MCP servers for API testing. The Brave Search and GitHub servers are useful for testing external APIs.',
        code: `agora install mcp-github`
      },
      {
        title: 'Test REST Endpoints',
        content:
          'With the MCP tools configured, you can ask OpenCode to test API endpoints: "Make a GET request to https://api.example.com/health" or "Test the POST /users endpoint with this payload."'
      },
      {
        title: 'Automate API Tests',
        content:
          'Use the TDD workflow combined with API tools to write automated tests: "Create a test suite that verifies all API endpoints return correct status codes and response shapes."'
      }
    ]
  },
  {
    id: 'tut-vector-search',
    title: 'Vector Search with MCP',
    description: 'Set up and query vector databases for semantic search and RAG applications',
    level: 'advanced',
    duration: '30 min',
    steps: [
      {
        title: 'Choose a Vector Database',
        content:
          'Agora supports several vector databases. For local development, ChromaDB is the easiest to start with. For production, Pinecone or Qdrant are recommended.',
        code: `agora search vector
agora browse mcp-chromadb`
      },
      {
        title: 'Install and Configure',
        content: 'Install your chosen vector database MCP server and add it to OpenCode:',
        code: `npm install -g chromadb-mcp-server`
      },
      {
        title: 'Semantic Search in Action',
        content:
          'With vector search configured, you can ask OpenCode to: "Search for documents similar to this text" or "Find the most relevant code examples for implementing OAuth." The AI will use the vector database to find semantically similar content.'
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
  },
  {
    id: 'tut-agora-auth',
    title: 'Agora Auth & Login',
    description: 'Authenticate with the Agora API using the device-code login flow',
    level: 'beginner',
    duration: '10 min',
    steps: [
      {
        title: 'Why Authenticate?',
        content:
          'Some Agora features require authentication: publishing packages, posting discussions, submitting reviews, and viewing community profiles. The device-code flow lets you log in via your browser without exposing tokens.'
      },
      {
        title: 'Device-Code Login',
        content:
          'Run `agora auth login --api-url <your-api-url>`. This opens a browser where you authorize via GitHub. The CLI polls for the token and stores it locally. No token ever appears in your terminal history.',
        code: `agora auth login --api-url https://api.agora.example.com`
      },
      {
        title: 'Check Your Status',
        content:
          'Use `agora auth status` to see if you are logged in. The token is displayed masked (e.g. "ghp_...cdef"). Use `agora auth logout` to clear stored credentials.',
        code: `agora auth status --json`
      },
      {
        title: 'Headless / CI Login',
        content:
          'For automation, pass a token directly via --token or the AGORA_TOKEN environment variable. This skips the browser flow and stores the credential immediately.',
        code: `agora auth login --token $AGORA_TOKEN --api-url https://api.agora.example.com`
      }
    ]
  },
  {
    id: 'tut-catalog-contrib',
    title: 'Contributing to the Catalog',
    description: 'Add MCP servers, workflows, and tutorials to the Agora ecosystem',
    level: 'intermediate',
    duration: '20 min',
    steps: [
      {
        title: 'The Offline Catalog',
        content:
          'Agora ships with a bundled offline catalog in src/data.ts. It contains MCP servers, prompt tools, workflows, and tutorials. The catalog is refreshed periodically and serves as the default data source when no API is available.'
      },
      {
        title: 'Add an MCP Server',
        content:
          'To add a new MCP server, append an entry to the samplePackages array in src/data.ts. Include the id, name, npm package, description, tags, and metadata. Run the tests to verify your entry works.',
        code: `{
  id: 'mcp-my-server',
  name: '@you/mcp-server',
  description: 'Description of what it does',
  author: 'You',
  version: '1.0.0',
  category: 'mcp',
  tags: ['your-tag', 'tool'],
  stars: 100,
  installs: 500,
  npmPackage: '@you/mcp-server',
  createdAt: '2026-05-15'
}`
      },
      {
        title: 'Add a Workflow',
        content:
          'Workflows are structured prompts that guide AI behavior. Add them to the sampleWorkflows array with a descriptive prompt that includes step-by-step instructions, tags, and metadata.',
        code: `{
  id: 'wf-my-workflow',
  name: 'My Workflow Name',
  description: 'What this workflow does',
  author: 'you',
  prompt: 'Step-by-step instructions for the AI to follow...',
  tags: ['your-tag'],
  stars: 1,
  forks: 0,
  createdAt: '2026-05-15'
}`
      },
      {
        title: 'Add a Tutorial',
        content:
          'Tutorials guide users through multi-step learning paths. Add them to the sampleTutorials array with a unique id, title, level, duration, and an array of steps. Each step has a title and content, with optional code blocks.',
        code: `{
  id: 'tut-my-topic',
  title: 'My Tutorial',
  description: 'What users will learn',
  level: 'beginner',
  duration: '15 min',
  steps: [
    { title: 'First Step', content: 'Explanation...' },
    { title: 'Second Step', content: 'More details...', code: 'example command' }
  ]
}`
      },
      {
        title: 'Submit a Pull Request',
        content:
          'After adding your entries to data.ts, run the tests with \`bun test\`, build with \`npm run build\`, and submit a PR on GitHub. See CONTRIBUTING.md for the full contribution guide.'
      }
    ]
  },
  {
    id: 'tut-deploy-backend',
    title: 'Deploy the Agora Backend',
    description: 'Self-host the Agora API on Cloudflare Workers with D1',
    level: 'advanced',
    duration: '30 min',
    steps: [
      {
        title: 'Prerequisites',
        content:
          "To deploy the backend you need: a Cloudflare account, the Wrangler CLI installed, and Node.js 18+. The backend is a Cloudflare Workers app using Hono and D1 (Cloudflare's serverless SQLite)."
      },
      {
        title: 'Set Up D1 Database',
        content:
          'Create a D1 database and apply the schema. Note the database ID for the wrangler.toml configuration.',
        code: `wrangler login
wrangler d1 create agora
wrangler d1 execute agora --file=backend/schema.sql`
      },
      {
        title: 'Configure Secrets',
        content:
          'Set the required secrets for GitHub OAuth and JWT signing. Create a GitHub OAuth App first at https://github.com/settings/developers.',
        code: `wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put AUTH_SECRET`
      },
      {
        title: 'Update wrangler.toml',
        content:
          'Edit backend/wrangler.toml with your D1 database ID from step 2. The binding name must stay as "DB" to match the TypeScript bindings.',
        code: `[[d1_databases]]
binding = "DB"
database_name = "agora"
database_id = "<your-database-id-here>"`
      },
      {
        title: 'Deploy',
        content:
          'Run the deploy command from the backend directory. After deployment, use the API URL with your CLI: `agora auth login --api-url https://your-worker.example.com`',
        code: `cd backend
npm run deploy`
      },
      {
        title: 'Local Development with Docker',
        content:
          'For local development without deploying, use Docker Compose. It runs wrangler with a local D1 SQLite database so you can iterate on the API without a Cloudflare account.',
        code: `docker compose up --build
# API available at http://localhost:8787
curl http://localhost:8787/health`
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
