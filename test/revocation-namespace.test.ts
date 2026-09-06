import { describe, expect, test } from 'vitest';
import { enumerateNamespace } from '../src/revocation/namespace';

// The feed's coverage used to be whatever the bundled sample catalog happened
// to list. These tests are mostly about one property: a partial enumeration
// must never be reported as a complete one, because "not asked about" and
// "asked about and clean" are the same shape in the output and only one of them
// is safe to act on.

interface PageSpec {
  names: { name: string; npm?: string }[];
  nextCursor?: string;
}

/** A fake registry serving fixed pages keyed by the cursor used to reach them. */
function registry(pages: Record<string, PageSpec>, opts: { failOn?: string } = {}) {
  return ((url: string | URL) => {
    const u = new URL(String(url));
    const cursor = u.searchParams.get('cursor') ?? '';
    if (opts.failOn === cursor) {
      return Promise.resolve(new Response('', { status: 503 }));
    }
    const page = pages[cursor];
    if (!page) return Promise.resolve(new Response('', { status: 404 }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          servers: page.names.map((n) => ({
            server: {
              name: n.name,
              description: '',
              version: '1.0.0',
              packages: n.npm ? [{ registryType: 'npm', identifier: n.npm }] : []
            }
          })),
          metadata: page.nextCursor ? { nextCursor: page.nextCursor } : {}
        }),
        { status: 200 }
      )
    );
  }) as never;
}

describe('enumerateNamespace', () => {
  test('walks every page and collects npm purls', async () => {
    const result = await enumerateNamespace({
      env: {
        fetcher: registry({
          '': { names: [{ name: 'a/one', npm: 'one' }], nextCursor: 'c1' },
          c1: { names: [{ name: 'a/two', npm: '@scope/two' }] }
        })
      } as never
    });

    expect(result.complete).toBe(true);
    expect(result.pages).toBe(2);
    expect(result.servers).toBe(2);
    expect(result.purls).toEqual(['pkg:npm/%40scope/two', 'pkg:npm/one']);
  });

  test('counts servers that ship no npm package without inventing a purl', async () => {
    // Remote-only servers are real and cannot be queried against OSV, which is
    // keyed by package identity. The gap belongs in the numbers, not behind a
    // synthetic identifier nothing else would recognise.
    const result = await enumerateNamespace({
      env: {
        fetcher: registry({
          '': { names: [{ name: 'a/remote' }, { name: 'a/pkg', npm: 'pkg' }] }
        })
      } as never
    });

    expect(result.servers).toBe(2);
    expect(result.purls).toEqual(['pkg:npm/pkg']);
    expect(result.complete).toBe(true);
  });

  test('deduplicates a package listed by more than one server', async () => {
    const result = await enumerateNamespace({
      env: {
        fetcher: registry({
          '': {
            names: [
              { name: 'a/one', npm: 'shared' },
              { name: 'b/one', npm: 'shared' }
            ]
          }
        })
      } as never
    });

    expect(result.purls).toEqual(['pkg:npm/shared']);
  });

  test('retries a failed page instead of discarding the walk behind it', async () => {
    // Observed against the live registry: a single HTTP 500 on page 135 of 135
    // ended a walk that had already collected 3,257 artifacts. Cursor
    // pagination cannot skip — the next cursor arrives in the failed response —
    // so retrying the same cursor is the only recovery there is.
    let attempts = 0;
    const flaky = ((url: string | URL) => {
      const cursor = new URL(String(url)).searchParams.get('cursor') ?? '';
      if (cursor === 'c1' && attempts++ < 2) {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      const page =
        cursor === ''
          ? { name: 'a/one', npm: 'one', next: 'c1' }
          : { name: 'a/two', npm: 'two', next: undefined };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            servers: [
              {
                server: {
                  name: page.name,
                  packages: [{ registryType: 'npm', identifier: page.npm }]
                }
              }
            ],
            metadata: page.next ? { nextCursor: page.next } : {}
          }),
          { status: 200 }
        )
      );
    }) as never;

    const result = await enumerateNamespace({
      env: { fetcher: flaky } as never,
      sleep: async () => {}
    });

    expect(result.complete).toBe(true);
    expect(result.purls).toEqual(['pkg:npm/one', 'pkg:npm/two']);
  });

  test('a page that fails every attempt yields complete:false with the purls it did confirm', async () => {
    // The load-bearing case. Pages beyond the failure were never asked about,
    // and reporting them as absent would drop live advisories for every package
    // on them.
    const result = await enumerateNamespace({
      env: {
        fetcher: registry(
          {
            '': { names: [{ name: 'a/one', npm: 'one' }], nextCursor: 'c1' },
            c1: { names: [{ name: 'a/two', npm: 'two' }] }
          },
          { failOn: 'c1' }
        )
      } as never,
      sleep: async () => {}
    });

    expect(result.complete).toBe(false);
    expect(result.reason).toContain('page 2 failed after 3 attempts');
    expect(result.purls).toEqual(['pkg:npm/one']);
  });

  test('a failure on the very first page is not an empty census', async () => {
    const result = await enumerateNamespace({
      env: { fetcher: registry({}, { failOn: '' }) } as never,
      sleep: async () => {}
    });

    expect(result.complete).toBe(false);
    expect(result.purls).toEqual([]);
    expect(result.pages).toBe(0);
  });

  test('a repeating cursor stops the walk and is not reported as finished', async () => {
    const result = await enumerateNamespace({
      env: {
        fetcher: registry({
          '': { names: [{ name: 'a/one', npm: 'one' }], nextCursor: 'loop' },
          loop: { names: [{ name: 'a/two', npm: 'two' }], nextCursor: 'loop' }
        })
      } as never
    });

    expect(result.complete).toBe(false);
    expect(result.reason).toContain('looping');
    expect(result.purls).toEqual(['pkg:npm/one', 'pkg:npm/two']);
  });

  test('the page guard stops an unbounded walk without claiming completeness', async () => {
    let n = 0;
    const endless = (() => {
      n++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            servers: [
              {
                server: {
                  name: `a/s${n}`,
                  packages: [{ registryType: 'npm', identifier: `p${n}` }]
                }
              }
            ],
            metadata: { nextCursor: `c${n}` }
          }),
          { status: 200 }
        )
      );
    }) as never;

    const result = await enumerateNamespace({ env: { fetcher: endless } as never, maxPages: 3 });

    expect(result.pages).toBe(3);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain('3-page guard');
  });

  test('reports progress per page so a long walk is not silent', async () => {
    const seen: number[] = [];
    await enumerateNamespace({
      env: {
        fetcher: registry({
          '': { names: [{ name: 'a/one', npm: 'one' }], nextCursor: 'c1' },
          c1: { names: [{ name: 'a/two', npm: 'two' }] }
        })
      } as never,
      onPage: (pages) => seen.push(pages)
    });

    expect(seen).toEqual([1, 2]);
  });
});
