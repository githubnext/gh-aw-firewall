# Agentic Workflow Firewall Documentation

This directory contains the Astro Starlight documentation site for the Agentic Workflow Firewall.

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The site will be available at `http://localhost:4321`

### Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## Structure

```
docs-site/
├── src/
│   ├── assets/          # Images and static assets
│   ├── content/
│   │   └── docs/        # Documentation content (Markdown/MDX)
│   └── styles/          # Custom CSS
├── public/              # Public static files
├── astro.config.mjs     # Astro configuration
└── package.json
```

## Deployment

The documentation is automatically deployed to GitHub Pages when changes are pushed to the `main` branch.

Workflow: `.github/workflows/deploy-docs.yml`

## Links

- [Astro Documentation](https://docs.astro.build/)
- [Starlight Documentation](https://starlight.astro.build/)
- [Live Site](https://githubnext.github.io/gh-aw-firewall/)
