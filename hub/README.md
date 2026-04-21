# Agora Admin Hub

A web-based admin dashboard for managing the Agora marketplace.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AGORA ADMIN HUB                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐        │
│  │   Dashboard │   │  Packages  │   │ Analytics  │        │
│  │   (stats)   │   │  (CRUD)    │   │  (charts)  │        │
│  └─────────────┘   └─────────────┘   └─────────────┘        │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐        │
│  │ Discussions │   │  Reviews   │   │ Settings   │        │
│  │  (mods)    │   │ (ratings)  │   │ (config)   │        │
│  └─────────────┘   └─────────────┘   └─────────────┘        │
├─────────────────────────────────────────────────────────────┤
│                    BACKEND API                           │
│  ┌───────────────────────────────────────────────┐        │
│  │        Cloudflare Workers + D1               │        │
│  └───────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Features

### Required for Deployment

1. **Cloudflare Workers** - API server (already in `/backend`)
2. **D1 Database** - Storage (schema in `/backend/schema.sql`)
3. **GitHub OAuth** - Admin authentication
4. **Custom Domain** - e.g., `hub.agora.sh`

### Admin Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Dashboard | View stats, recent activity | High |
| Package Management | Add, edit, remove packages | High |
| User Management | View, ban, delete users | High |
| Category Management | Create, edit categories | Medium |
| Analytics | Views, installs, trends | Medium |
| Settings | Configure marketplace | Low |

### Data Stored

- Users (with GitHub OAuth)
- Packages (npm MCP servers)
- Workflows (shared prompts)
- Discussions
- Reviews/Ratings
- Analytics events

## Deployment

```bash
# 1. Deploy backend first
cd backend
wrangler deploy

# 2. Set up authentication
# Create GitHub OAuth app

# 3. Deploy hub (future)
# Could be a simple Hono static site
```

## Security

- Admin access via GitHub OAuth only
- Role-based permissions (admin, moderator, viewer)
- Rate limiting
- Audit logging

## Future: Automatic npm Scanning

The hub can periodically fetch from npm to discover new MCP packages:

```typescript
// Scheduled worker
app.scheduled(async (event, env) => {
  const results = await fetch('https://registry.npmjs.org/-/v1/search?text=mcp&size=50');
  const packages = await results.json();
  
  for (const pkg of packages.objects) {
    if (isMcpServer(pkg)) {
      await upsertPackage(pkg);
    }
  }
});
```