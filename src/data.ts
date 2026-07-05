import { readFileSync } from 'node:fs';
import type { Package, Workflow, Discussion, Tutorial } from './types.js';

const CATALOG_PATH = new URL('./catalog.json', import.meta.url);

interface Catalog {
  dataRefreshedAt: string;
  samplePackages: Package[];
  sampleWorkflows: Workflow[];
  sampleDiscussions: Discussion[];
  sampleTutorials: Tutorial[];
  trendingTags: string[];
}

let _catalog: Catalog | null = null;

function catalog(): Catalog {
  if (!_catalog) {
    _catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as Catalog;
  }
  return _catalog;
}

export const dataRefreshedAt: string = /* @__PURE__ */ (() => catalog().dataRefreshedAt)();
export const samplePackages: Package[] = /* @__PURE__ */ (() => catalog().samplePackages)();
export const sampleWorkflows: Workflow[] = /* @__PURE__ */ (() => catalog().sampleWorkflows)();
export const sampleDiscussions: Discussion[] = /* @__PURE__ */ (() =>
  catalog().sampleDiscussions)();
export const sampleTutorials: Tutorial[] = /* @__PURE__ */ (() => catalog().sampleTutorials)();
export const trendingTags: string[] = /* @__PURE__ */ (() => catalog().trendingTags)();
