# Agora - The Developer's Terminal Marketplace & Community

<p align="center">
  <strong>Where developers trade tools, ideas, and workflows</strong>
</p>

<p align="center">
  An OpenCode plugin that brings a marketplace, community, and knowledge base to your terminal.
</p>

---

## What is Agora?

Agora is an OpenCode plugin that transforms your terminal into a vibrant marketplace and community hub. Think of it as the ancient Greek agora - a place where developers gather to:

- 🔍 **Discover** - Browse and search MCP servers, prompts, and workflows
- 📦 **Install** - One-click install tools that integrate seamlessly with OpenCode
- 💬 **Discuss** - Share ideas, debate approaches, and learn from the community
- 📚 **Learn** - Interactive tutorials on AI, MCP, and modern development

## Features

### 📦 Marketplace
- Browse curated MCP servers and plugins
- Search by category, language, or use case
- One-click installation to your OpenCode config
- Ratings and reviews from the community

### 🔄 Workflows
- Share your agentic workflows
- Import battle-tested patterns from others
- Version control your prompts and workflows
- Fork and improve community workflows

### 💬 Community
- Discussion threads on tools and patterns
- Trending prompts and workflows
- Expert AMAs and knowledge sharing

### 📚 Learn
- Interactive tutorials on MCP
- AI development best practices
- Terminal productivity tips

## Installation

```bash
# Add to your opencode.json
npm install opencode-agora
```

Or add manually to `opencode.json`:

```json
{
  "plugins": ["opencode-agora"]
}
```

## Usage

Once installed, use these commands:

- `/agora search <query> [category]` - Search marketplace
- `/agora browse_category <category>` - Browse by category (mcp, workflow, prompt)
- `/agora browse <id>` - View package details
- `/agora trending [type]` - See trending packages/workflows
- `/agora install <id> [--write]` - Install to config
- `/agora review [action] [--id] [--rating] [--content]` - Reviews/ratings
- `/agora discussions [action] [--id] [--title] [--content]` - Community
- `/agora profile [action] [--username]` - User profiles
- `/agora tutorial [id] [step]` - Interactive tutorials
- `/agora info` - This help

**Categories:** mcp, prompt, workflow, skill

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Test
bun test

# Test locally (installs to opencode plugins dir)
bun run dev
```

## Architecture

```
agora/
├── src/              # OpenCode Plugin
│   ├── index.ts      # Main plugin (10 tools)
│   ├── api.ts        # API client with fallback
│   ├── logger.ts     # Error handling
│   ├── format.ts     # Output formatting
│   ├── config.ts     # MCP config generation
│   ├── data.ts       # Sample data
│   └── types.ts      # TypeScript types
│
├── backend/          # Cloudflare Workers API
│   ├── src/index.ts  # Hono server + routes
│   ├── schema.sql    # D1 database schema
│   └── services/      # npm + GitHub API clients
│
├── hub/              # Admin Hub (web dashboard)
│
├── test/             # Tests (66 passing)
└── dist/             # Built output
```

## Project Status

| Component | Status | Notes |
|-----------|--------|-------|
| Plugin (offline) | ✅ Ready | Works with sample data |
| API Client | ✅ Built | Connects to backend |
| Backend | ⚠️ Ready | Needs deployment |
| Admin Hub | 📋 Design | Not built yet |

## Next Steps (TODO)

- [ ] Deploy backend to Cloudflare Workers
- [ ] Set up GitHub OAuth for backend
- [ ] Publish plugin to npm
- [ ] Build admin hub web interface

## Testing

```bash
bun test
# 66 tests, 0 failures
```

## License

MIT

---

<p align="center">
  Built with ❤️ for the developer community
</p>