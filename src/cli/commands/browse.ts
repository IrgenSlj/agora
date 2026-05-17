import { spawn } from 'node:child_process';
import { findMarketplaceItem } from '../../marketplace.js';
import { writeLine, writeJson, usageError } from '../helpers.js';
import type { CommandHandler } from './types.js';

function openUrl(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['""', url] : [url];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

export const commandOpen: CommandHandler = async (parsed, io, _style) => {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'open requires an item id or URL');

  const printOnly = Boolean(parsed.flags.print);

  if (id.startsWith('http://') || id.startsWith('https://')) {
    if (parsed.flags.json) {
      writeJson(io.stdout, { id, url: id, opened: !printOnly });
      return 0;
    }
    if (printOnly) {
      writeLine(io.stdout, id);
      return 0;
    }
    openUrl(id);
    writeLine(io.stdout, id);
    return 0;
  }

  const item = findMarketplaceItem(id);
  if (!item) {
    writeLine(io.stderr, `Unknown item: ${id}`);
    return 1;
  }

  const url =
    (item.kind === 'package' ? item.repository : undefined) ||
    (item.kind === 'package' && item.npmPackage
      ? `https://www.npmjs.com/package/${item.npmPackage}`
      : undefined);

  if (!url) {
    writeLine(io.stderr, `No URL available for ${id}`);
    return 1;
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, { id: item.id, url, opened: !printOnly });
    return 0;
  }

  if (printOnly) {
    writeLine(io.stdout, url);
    return 0;
  }

  openUrl(url);
  writeLine(io.stdout, url);
  return 0;
};

export const commandShare: CommandHandler = async (parsed, io, _style) => {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'share requires an item id');

  const item = findMarketplaceItem(id);
  if (!item) {
    writeLine(io.stderr, `Unknown item: ${id}`);
    return 1;
  }

  const isPackage = item.kind === 'package';
  const repo = isPackage ? item.repository : undefined;
  const npm =
    isPackage && item.npmPackage ? `https://www.npmjs.com/package/${item.npmPackage}` : undefined;
  const link = repo || npm;
  const author = item.author ? ` by ${item.author}` : '';
  const linkLine = link ? `\n${link}` : '';
  const tags = item.tags?.length ? `\n${item.tags.map((t) => '#' + t).join(' ')}` : '';
  const snippet = `**${item.name}**${author}\n${item.description ?? ''}${linkLine}${tags}\n\nInstall: \`agora install ${item.id}\``;

  if (parsed.flags.json) {
    writeJson(io.stdout, { id: item.id, name: item.name, link, snippet });
    return 0;
  }

  writeLine(io.stdout, snippet);
  return 0;
};
