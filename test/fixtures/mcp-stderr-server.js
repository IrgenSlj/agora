#!/usr/bin/env node
// Fake MCP server that writes a known line to stderr then either exits
// non-zero or hangs, controlled by the MCP_STDERR_MODE env var.
//   exit  — write to stderr then process.exit(1)  (default)
//   hang  — write to stderr then stay alive forever (never answers MCP)

const mode = process.env.MCP_STDERR_MODE ?? 'exit';

process.stderr.write('AGORA_TEST_STDERR_LINE: something went wrong\n');

if (mode === 'hang') {
  // Stay alive but never write to stdout — triggers timeout
  setInterval(() => {}, 60000);
} else {
  // exit non-zero
  process.exit(1);
}
