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
│   │       ├── getting-started/
│   │       ├── guides/
│   │       ├── reference/
│   │       └── development/
│   └── styles/          # Custom CSS
├── public/              # Public static files
├── astro.config.mjs     # Astro configuration
└── package.json
```

## Writing Documentation

Documentation files are located in `src/content/docs/` and use Markdown or MDX format.

### Frontmatter

Each documentation page should include frontmatter:

```markdown
---
title: Page Title
description: Brief description of the page
---

Content here...
```

### Using Components

MDX files can use Astro and Starlight components:

```mdx
import { Card, CardGrid } from '@astrojs/starlight/components';

<CardGrid>
  <Card title="Feature" icon="rocket">
    Description
  </Card>
</CardGrid>
```

## Deployment

The documentation is automatically deployed to GitHub Pages when changes are pushed to the `main` branch.

Workflow: `.github/workflows/deploy-docs.yml`

## Links

- [Astro Documentation](https://docs.astro.build/)
- [Starlight Documentation](https://starlight.astro.build/)
- [Live Site](https://githubnext.github.io/gh-aw-firewall/)
