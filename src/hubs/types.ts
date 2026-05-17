export type Pricing =
  | { kind: 'free' }
  | { kind: 'paid'; amountCents: number; currency: string; provider: 'stripe' | 'lemon' };

export type InstallKind = 'git-clone' | 'mcp-config-patch' | 'package-install';

export interface HubItem {
  // Mirrors Package's required fields so it can be merged into the marketplace list.
  // The 'source' field distinguishes it from curated items.
  id: string; // e.g. "gh:owner/repo"
  source: 'github' | 'hf'; // future: 'gitlab'
  name: string;
  description: string;
  author: string;
  version: string; // default latest release tag, or commit short SHA
  category: 'mcp' | 'prompt' | 'workflow' | 'skill';
  tags: string[];
  stars: number;
  installs: number; // approximate; use stars as a proxy until we have download data
  repository: string;
  npmPackage?: string; // derived if topics include 'npm' or package.json was readable; leave undefined otherwise for v1
  createdAt: string; // ISO
  pricing: Pricing; // always { kind: 'free' } for live items in v1
  fetchedAt: string; // ISO — needed for cache TTL
  // GitHub-specific extras stored on the item for later enrichment:
  pushedAt: string;
  license: string | null;
  topics: string[];
}
