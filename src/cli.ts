#!/usr/bin/env node

// `hook check` runs before every MCP tool call, so it takes a path that skips
// the CLI entirely. Loading `app.js` pulls yargs, which is 51ms of argument
// parsing to handle two words this branch already knows. That is most of the
// latency a user would feel, on the one command whose cost is paid over and
// over rather than once.
//
// The condition is deliberately exact rather than a prefix match: anything but
// this precise invocation — a flag, a typo, `hook install` — falls through to
// the real CLI and gets real parsing and real error messages.
if (process.argv[2] === 'hook' && process.argv[3] === 'check' && process.argv.length === 4) {
  const { runHookCheck } = await import('./hook/run.js');
  process.exit(await runHookCheck());
}

const { runCli } = await import('./cli/app.js');

const exitCode = await runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd()
});

process.exit(exitCode);

// Both entry points are dynamic imports, which leaves the file with no static
// import or export and so not a module — and top-level await needs one.
export {};
