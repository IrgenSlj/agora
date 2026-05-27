import type { Permissions } from '../types.js';

export function renderPermissionLines(perms: Permissions | undefined): string[] {
  if (!perms) return ['Permissions  none declared'];
  const rows: string[] = [];
  if (perms.fs?.length) rows.push(`  fs    ${perms.fs.join(', ')}`);
  if (perms.net?.length) rows.push(`  net   ${perms.net.join(', ')}`);
  if (perms.exec?.length) rows.push(`  exec  ${perms.exec.join(', ')}`);
  if (rows.length === 0) return ['Permissions  none declared'];
  return ['Permissions', ...rows];
}

export function hasPermissions(perms: Permissions | undefined): boolean {
  if (!perms) return false;
  return Boolean(perms.fs?.length || perms.net?.length || perms.exec?.length);
}

export function describePermissionGlob(value: string): string {
  if (value === '*') return 'unrestricted';
  if (value === './**/*') return 'anywhere under the current working directory';
  if (value.includes('~/.config/agora')) return 'agora config directory only';
  return '';
}
