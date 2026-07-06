import { buildIndex, type IndexableItem, searchIndex } from '../../search/catalog-index.js';
import { readCapabilityCache } from '../../stack/capability-cache.js';
import { detectDataDir, stringFlag, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

interface FlatTool {
  server: string;
  serverInfo?: { name?: string; version?: string };
  name: string;
  description: string;
}

export const commandCapabilities: CommandHandler = async (parsed, io, style) => {
  const theme = cliTheme(style, io);
  const dataDir = detectDataDir(parsed, io);
  const entries = readCapabilityCache(dataDir);

  const serverFilter = stringFlag(parsed, 'server');
  const query = parsed.args.join(' ').trim();

  // Flatten: only entries with ok !== false
  let allTools: FlatTool[] = [];
  for (const entry of entries) {
    if (entry.ok === false) continue;
    for (const tool of entry.tools) {
      allTools.push({
        server: entry.name,
        serverInfo: entry.serverInfo,
        name: tool.name,
        description: tool.description ?? ''
      });
    }
  }

  // --server filter
  if (serverFilter !== undefined) {
    const lower = serverFilter.toLowerCase();
    const exact = allTools.filter((t) => t.server.toLowerCase() === lower);
    const filtered =
      exact.length > 0 ? exact : allTools.filter((t) => t.server.toLowerCase().includes(lower));
    if (filtered.length === 0 && !parsed.flags.json) {
      writeLine(io.stdout, theme.muted(`No tools found for server: ${serverFilter}`));
    }
    allTools = filtered;
  }

  // Empty cache (before server filter so we catch the truly empty state)
  if (entries.length === 0) {
    if (parsed.flags.json) {
      writeJson(io.stdout, {
        query: query || null,
        server: serverFilter ?? null,
        results: [],
        summary: { tools: 0, servers: 0 }
      });
      return 0;
    }
    writeLine(
      io.stdout,
      theme.muted(
        'No capability data found. Tools are discovered by probing your configured MCP servers.'
      )
    );
    writeLine(io.stdout, theme.muted('Hints:'));
    writeLine(io.stdout, theme.muted('  agora doctor --probe   (probe all configured servers)'));
    writeLine(io.stdout, theme.muted('  agora try <id>         (test-drive a marketplace item)'));
    return 0;
  }

  if (query) {
    // Query mode: BM25 ranking
    const items: IndexableItem[] = allTools.map((t) => ({
      id: `${t.server}::${t.name}`,
      name: t.name,
      description: t.description,
      author: t.server,
      category: 'tool',
      tags: [t.server]
    }));

    const index = buildIndex(items);
    const scored = searchIndex(index, query);

    // Map scored ids back to tools in ranked order, filtering to scored matches only
    const toolById = new Map<string, FlatTool>();
    for (const t of allTools) {
      toolById.set(`${t.server}::${t.name}`, t);
    }

    const rankedTools: Array<FlatTool & { score: number }> = [];
    for (const { id, score } of scored) {
      const tool = toolById.get(id);
      if (tool) rankedTools.push({ ...tool, score });
    }

    if (parsed.flags.json) {
      const serverSet = new Set(rankedTools.map((t) => t.server));
      writeJson(io.stdout, {
        query,
        server: serverFilter ?? null,
        results: rankedTools.map(({ server, name, description, score }) => ({
          server,
          name,
          description,
          score
        })),
        summary: { tools: rankedTools.length, servers: serverSet.size }
      });
      return 0;
    }

    if (rankedTools.length === 0) {
      writeLine(io.stdout, theme.muted(`No tools matched: ${query}`));
      return 0;
    }

    for (const t of rankedTools) {
      writeLine(
        io.stdout,
        `${theme.accent(t.name)}  ${theme.dim(t.server + '  — ' + t.description)}`
      );
    }
    writeLine(io.stdout);
    const serverSet = new Set(rankedTools.map((t) => t.server));
    writeLine(
      io.stdout,
      theme.muted(`${rankedTools.length} tool(s) across ${serverSet.size} server(s)`)
    );
  } else {
    // List mode: grouped by server (servers sorted by name, tools sorted by name)
    const byServer = new Map<string, FlatTool[]>();
    for (const t of allTools) {
      let list = byServer.get(t.server);
      if (!list) {
        list = [];
        byServer.set(t.server, list);
      }
      list.push(t);
    }

    const sortedServers = Array.from(byServer.keys()).sort();

    if (parsed.flags.json) {
      const results = allTools
        .slice()
        .sort((a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name))
        .map(({ server, name, description }) => ({ server, name, description }));
      const serverSet = new Set(results.map((r) => r.server));
      writeJson(io.stdout, {
        query: null,
        server: serverFilter ?? null,
        results,
        summary: { tools: results.length, servers: serverSet.size }
      });
      return 0;
    }

    for (const serverName of sortedServers) {
      const tools = byServer
        .get(serverName)!
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
      const firstTool = tools[0];
      const version = firstTool?.serverInfo?.version;
      const header = version
        ? `${theme.accent(serverName)} ${theme.dim('v' + version)}`
        : theme.accent(serverName);
      writeLine(io.stdout, header);
      for (const t of tools) {
        writeLine(
          io.stdout,
          `  ${t.name}${t.description ? theme.dim('  — ' + t.description) : ''}`
        );
      }
      writeLine(io.stdout);
    }

    const serverSet = new Set(allTools.map((t) => t.server));
    writeLine(
      io.stdout,
      theme.muted(`${allTools.length} tool(s) across ${serverSet.size} server(s)`)
    );
  }

  return 0;
};
