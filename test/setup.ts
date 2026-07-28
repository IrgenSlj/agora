// Hermeticity guard.
//
// AGENTS.md promises the suite is hermetic. Nothing enforced that, so a command
// that reached for `globalThis.fetch` would silently make real network calls in
// CI — slow, flaky, and dependent on someone else's uptime. `agora today` did
// exactly this the moment news refresh moved into it.
//
// Every network-touching function in this codebase takes an injectable
// `FetchLike` (`src/fetch.ts`). This makes forgetting to pass one a loud
// failure instead of a silent live request.
//
// A test that genuinely needs to exercise fetch should inject its own fetcher
// (`createIo(cwd, { fetcher })`) or stub `globalThis.fetch` for its own scope.

const blocked = ((input: URL | RequestInfo) => {
  const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
  return Promise.reject(
    new Error(
      `Network access is blocked in tests (attempted: ${url}).\n` +
        'Inject a fetcher instead — every network call takes a FetchLike. See test/setup.ts.'
    )
  );
}) as typeof globalThis.fetch;

globalThis.fetch = blocked;
