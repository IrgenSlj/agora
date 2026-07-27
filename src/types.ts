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
  category: 'mcp' | 'prompt' | 'skill' | 'other';
  tags: string[];
  stars: number;
  installs: number;
  repository?: string;
  npmPackage?: string;
  createdAt: string;
  permissions?: Permissions;
  flagCount?: number;
  /** Origin of the entry: undefined = curated bundled catalog. */
  source?: 'github' | 'hf';
  /** Last upstream push for live hub items (HF lastModified, GH pushedAt). */
  pushedAt?: string;
  /** AI-generated install hint from curation. */
  installHint?: string;
  /** ISO timestamp when AI verification last ran. */
  aiVerifiedAt?: string;
}
