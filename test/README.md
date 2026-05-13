# Agora Tests

## Running Tests

```bash
bun test
```

## Test Suites

### Data Tests (`index.test.ts`)
- Sample data validation
- Search logic
- Trending/sorting
- Category filtering
- Edge cases

### API Tests (`api.test.ts`)
- API client functions
- Error handling
- Fallback behavior

### Type Tests (`types.test.ts`)
- TypeScript type validation
- Type compatibility
- JSON serialization

### Format Tests (`format.test.ts`)
- String truncation
- Number formatting
- Date formatting
- Table/list/card formatting

### CLI Tests (`cli.test.ts`)
- Argument parsing
- Search and JSON output
- Browse error handling
- Install preview and config writes
- Config doctor output
- Local saved-item state
- Auth token state
- Live API source and offline fallback
- Discussion creation
- Publish/review API commands
- Profile lookup

## Coverage

- **5 test files**
- Tests cover: argument parsing, search, browse, install, config doctor,
  saved items, auth login/logout/status, live API fallback, discussion
  creation, publish/review API, profile lookup, data validation, formatting

## Adding Tests

```typescript
import { describe, test, expect } from 'bun:test';

describe('My Feature', () => {
  test('should do something', () => {
    expect(true).toBe(true);
  });
});
```

Run with watch mode:
```bash
bun test --watch
```
