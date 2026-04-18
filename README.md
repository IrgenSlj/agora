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
  "plugin": ["opencode-agora"]
}
```

## Usage

Once installed, Agora appears as a panel in OpenCode:

- `/agora` - Open the Agora marketplace
- `/agora search <query>` - Search for tools and workflows
- `/agora trending` - See what's popular
- `/agora install <package>` - Install a package
- `/agora share` - Share your workflow

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Test locally
bun run dev
```

## License

MIT

---

<p align="center">
  Built with ❤️ for the developer community
</p>