export interface FormatterOptions {
  maxWidth?: number;
  indent?: number;
  icons?: boolean;
}

const defaultOptions: Required<FormatterOptions> = {
  maxWidth: 80,
  indent: 2,
  icons: true
};

export function formatList(
  items: { name: string; description?: string; stars?: number; author?: string }[],
  options: FormatterOptions = {}
): string {
  const { maxWidth, indent, icons } = { ...defaultOptions, ...options };
  const padding = ' '.repeat(indent);
  
  return items.map((item, i) => {
    const icon = icons ? '• ' : `${i + 1}. `;
    const line = `${padding}${icon}${item.name}`;
    const lines = [line];
    
    if (item.description) {
      const desc = truncate(item.description, maxWidth - indent - 4);
      lines.push(`${padding}  ${desc}`);
    }
    
    if (item.stars !== undefined) {
      lines.push(`${padding}  ⭐ ${item.stars} ${item.author ? `• ${item.author}` : ''}`);
    }
    
    return lines.join('\n');
  }).join('\n\n');
}

export function formatCard(
  title: string,
  fields: Record<string, string>,
  options: FormatterOptions = {}
): string {
  const { indent } = { ...defaultOptions, ...options };
  const padding = ' '.repeat(indent);
  
  const lines = [
    `${padding}**${title}**`,
    ...Object.entries(fields).map(([key, value]) => 
      `${padding}  ${key}: ${value}`
    )
  ];
  
  return lines.join('\n');
}

export function formatTable(
  headers: string[],
  rows: string[][],
  options: FormatterOptions = {}
): string {
  const { maxWidth, indent } = { ...defaultOptions, ...options };
  const padding = ' '.repeat(indent);
  
  const colWidths = headers.map((h, i) => {
    const maxCell = Math.max(h.length, ...rows.map(r => (r[i] || '').length));
    return Math.min(maxCell, Math.floor(maxWidth / headers.length) - 2);
  });
  
  const formatRow = (cells: string[]) =>
    cells.map((c, i) => c.slice(0, colWidths[i]).padEnd(colWidths[i])).join(' | ');
  
  const separator = colWidths.map(w => '-'.repeat(w)).join('-+-');
  
  return [
    padding + formatRow(headers),
    padding + separator,
    ...rows.map(row => padding + formatRow(row))
  ].join('\n');
}

export function formatSection(
  title: string,
  content: string,
  options: FormatterOptions = {}
): string {
  const { maxWidth } = { ...defaultOptions, ...options };
  const divider = '─'.repeat(Math.min(title.length + 2, maxWidth));
  
  return `\n${title}\n${divider}\n${content}`;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export function formatStars(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

export function formatInstalls(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return String(count);
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export function formatPackage(
  pkg: { name: string; description?: string; version?: string; author?: string; stars?: number; installs?: number; category?: string; tags?: string[]; repository?: string; npmPackage?: string }
) {
  const fields: Record<string, string> = {};
  
  if (pkg.version) fields['Version'] = pkg.version;
  if (pkg.author) fields['Author'] = pkg.author;
  if (pkg.category) fields['Category'] = pkg.category;
  if (pkg.stars !== undefined) fields['Stars'] = formatStars(pkg.stars);
  if (pkg.installs !== undefined) fields['Installs'] = formatInstalls(pkg.installs);
  if (pkg.description) fields['Description'] = pkg.description;
  if (pkg.tags?.length) fields['Tags'] = pkg.tags.join(', ');
  if (pkg.repository) fields['Repository'] = pkg.repository;
  if (pkg.npmPackage) fields['npm'] = pkg.npmPackage;
  
  return formatCard(pkg.name, fields);
}

export function formatWorkflow(
  wf: { name: string; description?: string; author?: string; stars?: number; forks?: number; tags?: string[]; model?: string }
) {
  const fields: Record<string, string> = {};
  
  if (wf.author) fields['Author'] = wf.author;
  if (wf.stars !== undefined) fields['Stars'] = formatStars(wf.stars);
  if (wf.forks !== undefined) fields['Forks'] = String(wf.forks);
  if (wf.model) fields['Model'] = wf.model;
  if (wf.description) fields['Description'] = wf.description;
  if (wf.tags?.length) fields['Tags'] = wf.tags.join(', ');
  
  return formatCard(wf.name, fields);
}