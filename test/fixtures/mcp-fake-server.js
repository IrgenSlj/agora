#!/usr/bin/env node
// Minimal fake MCP server for testing probeMcpServer.
// Reads newline-delimited JSON-RPC from stdin and replies on stdout.

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!msg || typeof msg !== 'object') continue;

    if (msg.method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'fake', version: '1.0' },
          capabilities: {}
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    } else if (msg.method === 'notifications/initialized') {
      // Notification — no response
    } else if (msg.method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [{ name: 'echo', description: 'echoes' }, { name: 'add' }]
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      // After replying to tools/list, we can stay alive (probe will SIGTERM us)
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});
