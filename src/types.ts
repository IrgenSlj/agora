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
  /**
   * Install/download count, when the source actually measures one.
   *
   * Undefined means *not measured*, which is not zero. Most upstream registries
   * publish no such number; rendering their absence as `0 installs` put a
   * fabricated measurement next to every result, and the value it replaced was
   * worse — GitHub stars, copied into this field as a "proxy", which is why
   * search rows showed the same figure twice under two different labels.
   */
  installs?: number;
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
