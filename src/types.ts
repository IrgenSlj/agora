export type Pricing =
  | { kind: 'free' }
  | { kind: 'paid'; amountCents: number; currency: string; provider: 'stripe' | 'lemon' };

export interface Permissions {
  fs?: string[];
  net?: string[];
  exec?: string[];
}

export interface Package {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: 'mcp' | 'prompt' | 'workflow' | 'skill';
  tags: string[];
  stars: number;
  installs: number;
  repository?: string;
  npmPackage?: string;
  createdAt: string;
  permissions?: Permissions;
  flagCount?: number;
  pricing?: Pricing;
  /** Origin of the entry: undefined = curated bundled catalog. */
  source?: 'github' | 'hf';
  /** Last upstream push for live hub items (HF lastModified, GH pushedAt). */
  pushedAt?: string;
  /** AI-generated install hint from curation. */
  installHint?: string;
  /** ISO timestamp when AI verification last ran. */
  aiVerifiedAt?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  author: string;
  prompt: string;
  model?: string;
  tags: string[];
  stars: number;
  forks: number;
  createdAt: string;
}
