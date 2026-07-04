// Federation source: the bundled/offline catalog. Always enabled, never touches
// the network — the source every other source degrades to (brief §5f).
import { searchMarketplaceItems, findMarketplaceItem } from '../../marketplace.js';
import type { MarketplaceItem } from '../../marketplace/types.js';
import type {
  FederatedItem,
  FederatedSearchOptions,
  FederationEnv,
  RegistrySource
} from '../types.js';

function toFederatedItem(item: MarketplaceItem, fetchedAt: string): FederatedItem {
  return {
    ...item,
    provenance: [{ source: 'local', fetchedAt }]
  };
}

export const localSource: RegistrySource = {
  id: 'local',
  displayName: 'Local catalog',

  isEnabled(): boolean {
    return true;
  },

  async search(query: string, opts: FederatedSearchOptions): Promise<FederatedItem[]> {
    try {
      const fetchedAt = new Date().toISOString();
      const items = searchMarketplaceItems({ query, limit: opts.limit });
      return items.map((item) => toFederatedItem(item, fetchedAt));
    } catch {
      return [];
    }
  },

  async fetchItem(ref: string, _env: FederationEnv): Promise<FederatedItem | null> {
    try {
      const item = findMarketplaceItem(ref);
      return item ? toFederatedItem(item, new Date().toISOString()) : null;
    } catch {
      return null;
    }
  }
};
