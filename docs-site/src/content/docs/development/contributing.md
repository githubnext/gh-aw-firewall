---
title: Contributing
description: How to contribute to the Agentic Workflow Firewall
---

Contributions are welcome! Please see this guide for details on how to contribute.

## Code of Conduct

This project follows the [GitHub Community Code of Conduct](https://docs.github.com/en/site-policy/github-terms/github-community-code-of-conduct).

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- Docker
- Git

### Setup Development Environment

```bash
# Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/gh-aw-firewall.git
cd gh-aw-firewall

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## Development Workflow

### Making Changes

1. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Run linter:
   ```bash
   npm run lint
   ```

4. Run tests:
   ```bash
   npm test
   ```

5. Build the project:
   ```bash
   npm run build
   ```

### Commit Message Format

This repository enforces [Conventional Commits](https://www.conventionalcommits.org/):

**Format:** `type(scope): subject`

**Rules:**
- `type` and `subject` must be lowercase
- No period at end of subject
- Header max 72 characters
- Both commit messages AND PR titles must follow this format

**Common types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `chore`: Maintenance tasks
- `test`: Test changes
- `refactor`: Code refactoring
- `ci`: CI/CD changes

**Examples:**
- ✅ `docs: fix duplicate heading in release template`
- ✅ `feat: add new domain whitelist option`
- ✅ `fix(cleanup): resolve container cleanup race condition`
- ❌ `Fix bug` (missing type)
- ❌ `docs: Fix template.` (uppercase subject, period at end)

### Testing

```bash
# Run all tests
npm test

# Run unit tests
npm run test:unit

# Run integration tests (requires Docker)
npm run test:integration

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Code Style

- Follow existing code patterns
- Use TypeScript strict mode
- Add JSDoc comments for public APIs
- Keep functions focused and small
- Write self-documenting code

## Pull Request Process

1. Update documentation if needed
2. Add tests for new features
3. Ensure all tests pass
4. Update CHANGELOG.md if applicable
5. Submit PR with clear description
6. Link related issues

## Documentation

Documentation is built with Astro Starlight and located in `docs-site/`:

```bash
cd docs-site
npm install
npm run dev  # Preview at http://localhost:4321
```

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions
- Review existing issues and PRs

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
