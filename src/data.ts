import type { Package, Workflow, Discussion, Tutorial } from './types.js';

export const samplePackages: Package[] = [
  {
    id: 'mcp-filesystem',
    name: '@modelcontextprotocol/server-filesystem',
    description: 'Read, write, and edit files on your local filesystem',
    author: 'modelcontextprotocol',
    version: '0.5.0',
    category: 'mcp',
    tags: ['filesystem', 'files', 'io'],
    stars: 2450,
    installs: 89000,
    repository: 'https://github.com/modelcontextprotocol/server-filesystem',
    npmPackage: '@modelcontextprotocol/server-filesystem',
    createdAt: '2024-08-15'
  },
  {
    id: 'mcp-github',
    name: '@modelcontextprotocol/server-github',
    description: 'Interact with GitHub API - issues, PRs, repos, and more',
    author: 'modelcontextprotocol',
    version: '0.3.0',
    category: 'mcp',
    tags: ['github', 'git', 'api'],
    stars: 1890,
    installs: 45000,
    repository: 'https://github.com/modelcontextprotocol/server-github',
    npmPackage: '@modelcontextprotocol/server-github',
    createdAt: '2024-09-20'
  },
  {
    id: 'mcp-brave-search',
    name: '@modelcontextprotocol/server-brave-search',
    description: 'Web search using Brave Search API',
    author: 'modelcontextprotocol',
    version: '0.2.0',
    category: 'mcp',
    tags: ['search', 'web', 'brave'],
    stars: 890,
    installs: 23000,
    repository: 'https://github.com/modelcontextprotocol/server-brave-search',
    npmPackage: '@modelcontextprotocol/server-brave-search',
    createdAt: '2024-10-05'
  },
  {
    id: 'prompt-code-review',
    name: 'Comprehensive Code Review',
    description: 'Detailed code review with security, performance, and best practices',
    author: 'agora-community',
    version: '1.0.0',
    category: 'prompt',
    tags: ['review', 'security', 'best-practices'],
    stars: 324,
    installs: 1200,
    createdAt: '2025-01-10'
  },
  {
    id: 'workflow-refactor-large',
    name: 'Large Scale Refactor',
    description: 'Break down and refactor large codebases safely',
    author: 'agora-community',
    version: '2.0.0',
    category: 'workflow',
    tags: ['refactor', 'large-scale', 'safety'],
    stars: 189,
    installs: 567,
    createdAt: '2025-02-15'
  }
];

export const sampleWorkflows: Workflow[] = [
  {
    id: 'wf-tdd-cycle',
    name: 'TDD Development Cycle',
    description: 'Test-driven development workflow with red-green-refactor',
    author: 'testdriven',
    prompt: `You are following TDD methodology. For each feature request:
1. Write a failing test first
2. Write minimal code to pass the test
3. Refactor while keeping tests green

Always start by understanding the requirements and writing tests that describe expected behavior.`,
    model: 'claude-sonnet-4-5',
    tags: ['tdd', 'testing', 'workflow'],
    stars: 456,
    forks: 89,
    createdAt: '2025-01-20'
  },
  {
    id: 'wf-security-audit',
    name: 'Security Audit Workflow',
    description: 'Comprehensive security analysis of code',
    author: 'security-first',
    prompt: `Perform a thorough security audit of the codebase:
1. Check for OWASP Top 10 vulnerabilities
2. Look for hardcoded secrets and credentials
3. Validate input sanitization
4. Check dependency vulnerabilities
5. Review authentication and authorization

Report findings with severity levels and suggested fixes.`,
    tags: ['security', 'audit', 'owasp'],
    stars: 234,
    forks: 45,
    createdAt: '2025-02-01'
  }
];

export const sampleDiscussions: Discussion[] = [
  {
    id: 'disc-mcp-vs-openai',
    title: 'MCP Servers vs OpenAI Function Calling - When to use which?',
    author: 'devarchitect',
    content: 'I\'ve been experimenting with both approaches. MCP seems more flexible for tool-based workflows, but function calling is simpler to set up. What\'s your experience?',
    category: 'question',
    replies: 23,
    stars: 45,
    createdAt: '2025-03-01'
  },
  {
    id: 'disc-best-coder-model',
    title: 'Best local model for coding in 2025?',
    author: 'local-llm-fan',
    content: 'With Qwen3, DeepSeek Coder V2, and others, what are you using for local development?',
    category: 'discussion',
    replies: 67,
    stars: 89,
    createdAt: '2025-03-10'
  }
];

export const sampleTutorials: Tutorial[] = [
  {
    id: 'tut-mcp-basics',
    title: 'MCP Servers 101',
    description: 'Learn the fundamentals of Model Context Protocol',
    level: 'beginner',
    duration: '15 min',
    steps: [
      {
        title: 'What is MCP?',
        content: 'The Model Context Protocol (MCP) is an open protocol that enables AI models to connect with external tools and data sources. Think of it as a USB-C port for AI - a standardized way to connect AI to anything.',
        code: undefined
      },
      {
        title: 'Your First MCP Server',
        content: 'Let\'s install the filesystem MCP server which allows AI to read and write files.',
        code: 'npm install -g @modelcontextprotocol/server-filesystem'
      },
      {
        title: 'Configure in OpenCode',
        content: 'Add the MCP server to your OpenCode configuration:',
        code: `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "./"]
    }
  }
}`
      }
    ]
  },
  {
    id: 'tut-agents-skills',
    title: 'OpenCode Agents & Skills Deep Dive',
    description: 'Master the three-tier extensibility system',
    level: 'intermediate',
    duration: '30 min',
    steps: [
      {
        title: 'Skills - Lightweight Prompts',
        content: 'Skills are markdown files that define agent behavior. They\'re the lightest form of customization.',
        code: undefined
      },
      {
        title: 'Agents - Specialized Workers',
        content: 'Agents are specialized AI workers with specific roles and capabilities.',
        code: undefined
      },
      {
        title: 'Plugins - Full Integration',
        content: 'Plugins provide full TypeScript integration with hooks, tools, and event handlers.',
        code: undefined
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
  'productivity'
];
