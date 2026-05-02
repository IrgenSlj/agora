# Agora Hub

<p align="center">
  An optional local web console for curating the Agora marketplace.
</p>

Agora is CLI-first. The Hub is a companion surface for visual browsing, install-plan review, and moderation workflows.

## Purpose

Allows users to:
- Browse and preview Agora packages, skills, prompts, and workflows
- Build an OpenCode install plan and copy generated `opencode.json`
- Moderate community discussions
- View lightweight marketplace analytics

## Architecture

```text
AGORA HUB
|-- Overview: stats, activity, analytics
|-- Marketplace: package search, filters, details
|-- Workflows: prompt preview and install planning
|-- Community: discussion moderation and drafts
`-- Install plan: generated opencode.json and commands

Future connected mode:
Cloudflare Workers API + D1 database
```

## Tech Stack

- **Frontend**: static HTML, CSS, and JavaScript
- **Local server**: Bun
- **Backend**: Cloudflare Workers API in `/backend` for a future connected mode
- **Database**: Cloudflare D1 schema in `/backend/schema.sql`

## Pages

### Dashboard
- Stats: total packages, users, discussions
- Recent activity feed
- Package analytics

### Packages
- Search, filter, and sort package listings
- Inspect package metadata
- Add installable items to an install plan

### Discussions
- View all discussions
- Moderate by pinning or marking reviewed
- Create local discussion drafts

### Install Plan
- Review selected packages and workflows
- Preview `opencode.json`
- Copy generated config and install commands

## Development

```bash
bun run hub:dev
```

Then open:

```text
http://localhost:4173
```

## Data Model

```text
Users -> Discussions -> Replies
Users -> Reviews -> Packages
Users -> Reviews -> Workflows
```

## Security

- This local version uses sample data and `localStorage`
- A deployed version should use GitHub OAuth
- Role-based permissions, rate limiting, and audit logging belong in the connected backend

## Status

**Working local app** - static Hub implementation is available in this directory.
