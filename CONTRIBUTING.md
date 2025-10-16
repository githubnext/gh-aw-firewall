# Contributing to Agentic Workflow Firewall

Thank you for your interest in contributing! We welcome contributions from the community and are excited to work with you.

## 🚀 Quick Start for Contributors

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/yourname/gh-aw-firewall.git
   cd awf
   ```

2. **Set up the development environment**
   ```bash
   # Install dependencies
   npm install

   # Build the project
   npm run build

3. **Submit your contribution**
   - Create a new branch for your feature or fix
   - Make your changes
   - Run tests and linter to ensure all checks pass
   - Submit a pull request

## 🛠️ Development Setup

### Prerequisites
- **Docker**: Must be running for integration tests
- **Node.js**: v18+ and npm
- **Root/Sudo Access**: Required for testing iptables functionality
- **Git**: For version control

### Build Commands
- `npm install` - Install dependencies
- `npm run build` - Build TypeScript to dist/
- `npm run dev` - Watch mode (rebuilds on changes)
- `npm test` - Run tests
- `npm test:watch` - Run tests in watch mode
- `npm run lint` - Lint TypeScript files
- `npm run clean` - Clean build artifacts

## 📝 How to Contribute

### Reporting Issues
- Use the GitHub issue tracker to report bugs
- Include detailed steps to reproduce the issue
- Include version information (`awf --version`)
- Include Docker version (`docker --version`)
- Include relevant log output (use `--log-level debug`)

### Suggesting Features
- Open an issue describing your feature request
- Explain the use case and how it would benefit users
- Include examples if applicable

### Contributing Code

#### Code Style
- Follow TypeScript best practices
- Use `npm run lint` to check code style
- Ensure all tests pass (`npm test`)
- Write tests for new functionality
- Add JSDoc comments for public APIs

#### Logging
When adding log output, always use the logger from `src/logger.ts`:

```typescript
import { logger } from './logger';

// Use appropriate log levels
logger.info('Starting operation...');
logger.debug('Configuration details:', config);
logger.warn('Potential issue detected');
logger.error('Operation failed:', error);
logger.success('Operation completed successfully');
```

#### File Organization
- Prefer creating new files grouped by functionality over adding to existing files
- Place core logic in `src/`
- Place container configurations in `containers/`
- Place CI/CD scripts in `scripts/ci/`
- Add tests alongside your code (e.g., `feature.ts` and `feature.test.ts`)

### Documentation
- Update documentation for any new features
- Add examples where helpful
- Ensure documentation is clear and concise

### Testing
- Write unit tests for new functionality
- Ensure all tests pass (`npm test`)
- Test manually with Docker containers when possible
- Integration tests require sudo access for iptables

## 🔄 Pull Request Process

1. **Before submitting:**
   - Run `npm run lint` to check code style
   - Run `npm test` to ensure all tests pass
   - Run `npm run build` to verify clean build
   - Test your changes manually
   - Update documentation if needed

2. **Pull request requirements:**
   - Clear description of what the PR does
   - Reference any related issues
   - Include tests for new functionality
   - Ensure CI passes

3. **Review process:**
   - Maintainers will review your PR
   - Address any feedback
   - Once approved, your PR will be merged

## 🏗️ Project Structure

```
/
├── src/                     # TypeScript source code
│   ├── cli.ts               # CLI entry point
│   ├── docker-manager.ts    # Docker container management
│   ├── squid-config.ts      # Squid proxy configuration
│   ├── host-iptables.ts     # Host-level iptables management
│   ├── logger.ts            # Logging utilities
│   └── types.ts             # TypeScript type definitions
├── containers/              # Docker container definitions
│   ├── squid/               # Squid proxy container
│   └── copilot/             # Copilot CLI container
├── scripts/                 # Utility scripts
│   └── ci/                  # CI/CD scripts
├── docs/                    # Documentation
├── .github/workflows/       # GitHub Actions CI/CD
├── dist/                    # Built JavaScript (generated)
├── package.json             # npm package configuration
└── tsconfig.json            # TypeScript configuration
```

## 🤝 Community

- Participate in discussions on GitHub issues
- Help other contributors and users

## 📜 Code of Conduct

This project follows the GitHub Community Guidelines. Please be respectful and inclusive in all interactions.

## ❓ Getting Help

- Check the [README.md](README.md) for usage instructions
- Review the [Quick Start Guide](docs/QUICKSTART.md) for setup
- Explore [AGENTS.md](AGENTS.md) for detailed development guidance
- Ask questions in GitHub issues
- Look at existing code and tests for examples

Thank you for contributing to Agentic Workflow Firewall! 🎉
