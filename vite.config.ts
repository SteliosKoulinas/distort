import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			// SvelteKit 3 reads its config from the Vite plugin, not svelte.config.js.
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html',
				precompress: false,
				strict: true
			})
		})
	],
	server: {
		host: '127.0.0.1',
		port: 5180,
		strictPort: true
	},
	preview: {
		host: '127.0.0.1',
		port: 4180,
		strictPort: true
	},
	build: {
		target: 'es2022'
	}
});
