import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
	site: 'https://github.github.io',
	base: '/gh-aw-firewall',
	integrations: [
		mermaid(),
		starlight({
			title: 'Agentic Workflow Firewall',
			description: 'Network firewall for agentic workflows with domain whitelisting',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/github/gh-aw-firewall' },
			],
			editLink: {
				baseUrl: 'https://github.com/github/gh-aw-firewall/edit/main/docs-site/',
			},
			logo: {
				src: './src/assets/logo.svg',
				replacesTitle: false,
			},
			customCss: [
				'./src/styles/custom.css',
			],
		}),
	],
});
