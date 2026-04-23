# Agora Admin Hub

A web-based admin dashboard for managing the Agora marketplace directly in the browser.

## Purpose

Allows users to:
- Browse and preview the Agora marketplace UI
- Manage packages, workflows, discussions
- View analytics and statistics
- Configure marketplace settings

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AGORA ADMIN HUB                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐      │
│  │   Dashboard │   │   Packages  │   │  Analytics  │      │
│  │   (stats)   │   │    (CRUD)   │   │   (charts)  │      │
│  └─────────────┘   └─────────────┘   └─────────────┘      │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐      │
│  │ Discussions │   │   Reviews   │   │   Settings   │      │
│  │   (mods)    │   │  (ratings)  │   │   (config)  │      │
│  └─────────────┘   └─────────────┘   └─────────────┘      │
├─────────────────────────────────────────────────────────────┤
│                    BACKEND API                             │
│  ┌───────────────────────────────────────────────┐        │
│  │     Cloudflare Workers + D1 Database           │        │
│  └───────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Frontend**: React or Next.js
- **Backend**: Cloudflare Workers (existing in `/backend`)
- **Database**: Cloudflare D1 (schema in `/backend/schema.sql`)
- **Auth**: GitHub OAuth

## Pages

### Dashboard
- Stats: total packages, users, discussions
- Recent activity feed
- Quick actions

### Packages
- List all packages with search/filter
- Add/edit/remove packages
- View install counts

### Discussions
- View all discussions
- Moderate (delete, pin)
- Reply to threads

### Analytics
- Install trends
- Popular packages
- User growth

### Settings
- Marketplace configuration
- Category management
- OAuth settings

## Deployment

```bash
# 1. Deploy backend first
cd backend
wrangler deploy

# 2. Set up GitHub OAuth app
# Create at: https://github.com/settings/applications/new
# Callback URL: https://your-domain.com/auth/callback

# 3. Deploy hub
# npm run build && wrangler pages deploy
```

## Development

```bash
cd hub
npm install
npm run dev
```

## Data Model

```
Users ──────── Discussions
  │                │
  │                ▼
  │           Replies
  │
  ▼
Reviews ───── Packages
  │              │
  └── Workflows ─┘
```

## Security

- Admin access via GitHub OAuth only
- Role-based permissions (admin, moderator, viewer)
- Rate limiting on API endpoints
- Audit logging for all changes

## Status

📋 **Design complete** - implementation not started

This is a future phase of development. The plugin works standalone without the hub.