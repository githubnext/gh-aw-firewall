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
		}),
	],
});
