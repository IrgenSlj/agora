import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// `agora --version` used to resolve 322 CommonJS modules before printing a
// string it already had in hand: 107ms of sigstore and 75ms of the MCP SDK,
// pulled in because the dispatch table imported all thirty command modules
// eagerly and one of them, somewhere down its own import graph, needed them.
//
// It is not an abstract cost. `uses: IrgenSlj/agora@v0` runs the CLI once per
// push per repository that adopts it, and the wedge the product is pointed at
// is the one place where startup is paid over and over by people who did not
// choose to pay it.
//
// This is a source-text assertion rather than a runtime one, deliberately. By
// the time a test can observe the module graph, vitest has already imported
// everything; the only place the property is visible is the file itself. It is
// checked here rather than left to review because the regression is invisible —
// adding one eager import back changes no behaviour and no test, it just
// quietly restores the cost.

const APP = readFileSync(join(__dirname, '..', '..', 'src', 'cli', 'app.ts'), 'utf8');

describe('command dispatch stays lazy', () => {
  test('no command module is imported at the top of app.ts', () => {
    const eager = [...APP.matchAll(/^import .*from '\.\/commands\/.*'/gm)]
      .map((m) => m[0])
      .filter((line) => !line.startsWith('import type'));

    expect(
      eager,
      'these pull a command module into every invocation, including `agora --version`'
    ).toEqual([]);
  });

  test('every handler in the table is reached through a dynamic import', () => {
    const table = APP.slice(APP.indexOf('const cmd: Record<'), APP.indexOf('const load = cmd['));
    const entries = [...table.matchAll(/^\s{6}([a-z]+):/gm)].map((m) => m[1]);

    // Guards against the assertion passing because the table moved or was
    // renamed and this now reads an empty string.
    expect(entries.length).toBeGreaterThan(30);

    const notLazy = entries.filter((name) => {
      const line = table.match(new RegExp(`^\\s{6}${name}:.*$`, 'm'))?.[0] ?? '';
      return !line.includes('import(') && !line.includes('configAlias');
    });
    expect(notLazy, 'these resolve their handler eagerly').toEqual([]);
  });

  test('the type-only import of CommandHandler is still allowed', () => {
    // A type import is erased at compile time and costs nothing at runtime.
    // The first assertion has to let it through or the file cannot be typed.
    expect(APP).toMatch(/^import type \{ CommandHandler \} from '\.\/commands\/types\.js';$/m);
  });
});
