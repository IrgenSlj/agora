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

## Coverage

- **79 tests passing**
- **179 assertions**
- **5 test files**

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
