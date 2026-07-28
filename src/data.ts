import { readFileSync } from 'node:fs';
import type { Package } from './types.js';

const CATALOG_PATH = new URL('./catalog.json', import.meta.url);

interface Catalog {
  dataRefreshedAt: string;
  samplePackages: Package[];
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
