---
title: Testing
description: Testing guide for the Agentic Workflow Firewall
---

## Test Structure

### Unit Tests

Located in `src/` with `.test.ts` suffix:

```bash
npm run test:unit
```

**Example test:**
```typescript
describe('squid-config', () => {
  it('should generate valid config', () => {
    const config = generateSquidConfig(['github.com']);
    expect(config).toContain('acl allowed_domains dstdomain github.com');
  });
});
```

### Integration Tests

Located in `tests/` directory:

```bash
npm run test:integration
```

**Key tests:**
- Domain whitelisting
- Container lifecycle
- Docker-in-docker support
- Log preservation
- Error handling

## Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only (requires Docker)
npm run test:integration

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

## Writing Tests

### Unit Tests

```typescript
import { generateSquidConfig } from './squid-config';

describe('squid-config', () => {
  it('should normalize domains', () => {
    const config = generateSquidConfig(['GitHub.COM']);
    expect(config).toContain('github.com');
  });

  it('should add subdomain wildcards', () => {
    const config = generateSquidConfig(['github.com']);
    expect(config).toContain('.github.com');
  });
});
```

### Integration Tests

```typescript
describe('domain filtering', () => {
  it('should allow whitelisted domains', async () => {
    const result = await exec('sudo awf --allow-domains github.com -- curl https://api.github.com');
    expect(result.exitCode).toBe(0);
  });

  it('should block non-whitelisted domains', async () => {
    const result = await exec('sudo awf --allow-domains github.com -- curl https://example.com');
    expect(result.exitCode).not.toBe(0);
  });
});
```

## Test Best Practices

1. **Clean up resources**: Always clean up containers/networks after tests
2. **Use timeouts**: Set appropriate timeouts for long-running tests
3. **Mock external services**: Don't rely on external APIs
4. **Test edge cases**: Cover error conditions and edge cases
5. **Keep tests focused**: One assertion per test when possible

## Continuous Integration

Tests run automatically on:
- Push to main branch
- Pull requests
- Release tags

**GitHub Actions workflows:**
- `.github/workflows/test-integration.yml` - Integration tests
- `.github/workflows/test-coverage.yml` - Coverage report

## Debugging Tests

```bash
# Run specific test file
npm test -- squid-config.test.ts

# Run with verbose output
npm test -- --verbose

# Run in debug mode
node --inspect-brk node_modules/.bin/jest --runInBand

# Keep containers for inspection
npm run test:integration -- --keep-containers
```

## Coverage Reports

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/lcov-report/index.html
```

**Coverage goals:**
- Statements: > 80%
- Branches: > 75%
- Functions: > 80%
- Lines: > 80%

## Manual Testing

```bash
# Build and test locally
npm run build
npm link
sudo awf --allow-domains github.com -- curl https://api.github.com

# Test with debug logging
sudo awf --allow-domains github.com --log-level debug -- your-command

# Test with keep-containers
sudo awf --keep-containers --allow-domains github.com -- your-command
docker logs awf-squid
docker logs awf-copilot
```
