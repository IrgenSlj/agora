import type { Discussion, Tutorial, TutorialStep } from '../types.js';
import type {
  MarketplaceItem,
  PackageMarketplaceItem,
  WorkflowMarketplaceItem
} from '../marketplace.js';

export type {
  Discussion,
  Tutorial,
  TutorialStep,
  MarketplaceItem,
  PackageMarketplaceItem,
  WorkflowMarketplaceItem
};

export type SourceName = 'api' | 'offline';
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface SourceOptions {
  useApi?: boolean;
  apiUrl?: string;
  token?: string;
  fetcher?: FetchLike;
  timeoutMs?: number;
}

export interface SearchSourceOptions extends SourceOptions {
  query?: string;
  category?: string;
  limit?: number;
  sortBy?: 'relevance' | 'stars' | 'installs' | 'name' | 'updated';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
}

export interface FindSourceOptions extends SourceOptions {
  id: string;
  type?: string;
}

export interface DiscussionSourceOptions extends SourceOptions {
  category?: string;
  query?: string;
}

export interface TutorialSourceOptions extends SourceOptions {
  query?: string;
  level?: string;
  limit?: number;
}

export interface FindTutorialSourceOptions extends SourceOptions {
  id: string;
}

export interface SourceResult<T> {
  source: SourceName;
  data: T;
  apiUrl?: string;
  fallbackReason?: string;
}

export interface PublishPackageInput {
  id?: string;
  name: string;
  description: string;
  version?: string;
  category?: string;
  tags?: string[];
  repository?: string;
  npmPackage?: string;
}

export interface PublishWorkflowInput {
  id?: string;
  name: string;
  description: string;
  prompt: string;
  model?: string;
  tags?: string[];
}

export interface ReviewInput {
  itemId: string;
  itemType: 'package' | 'workflow';
  rating: number;
  content: string;
}

export interface DiscussionInput {
  title: string;
  content: string;
  category?: string;
}

export interface ApiReview {
  id: string;
  itemId: string;
  itemType: 'package' | 'workflow';
  author: string;
  rating: number;
  content: string;
  createdAt: string;
}

export interface ApiProfile {
  id: string;
  username: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  packages: number;
  workflows: number;
  discussions: number;
  reputation?: number;
  joinedAt: string;
}

export interface MarketplaceFlagInput {
  reason: 'spam' | 'harassment' | 'undisclosed-llm' | 'malicious' | 'other';
  targetType: 'package' | 'workflow';
  notes?: string;
}
