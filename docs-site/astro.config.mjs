import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://githubnext.github.io',
	base: '/gh-aw-firewall',
	integrations: [
		starlight({
			title: 'Agentic Workflow Firewall',
			description: 'Network firewall for agentic workflows with domain whitelisting',
			social: {
				github: 'https://github.com/githubnext/gh-aw-firewall',
			},
			editLink: {
				baseUrl: 'https://github.com/githubnext/gh-aw-firewall/edit/main/docs-site/',
			},
			logo: {
				src: './src/assets/logo.svg',
				replacesTitle: false,
			},
			customCss: [
				'./src/styles/custom.css',
			],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Quick Start', slug: 'getting-started/quickstart' },
						{ label: 'Installation', slug: 'getting-started/installation' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Usage Guide', slug: 'guides/usage' },
						{ label: 'GitHub Actions Integration', slug: 'guides/github-actions' },
						{ label: 'Environment Variables', slug: 'guides/environment' },
						{ label: 'Troubleshooting', slug: 'guides/troubleshooting' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Architecture', slug: 'reference/architecture' },
						{ label: 'Logging', slug: 'reference/logging' },
						{ label: 'Squid Log Filtering', slug: 'reference/squid-log-filtering' },
					],
				},
				{
					label: 'Development',
					items: [
						{ label: 'Contributing', slug: 'development/contributing' },
						{ label: 'Testing', slug: 'development/testing' },
						{ label: 'Releasing', slug: 'development/releasing' },
					],
				},
			],
		}),
	],
});
