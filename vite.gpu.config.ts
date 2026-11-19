import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** Standalone local test server; SvelteKit intentionally does not serve tests/. */
export default defineConfig({
	cacheDir: 'node_modules/.vite-gpu',
	resolve: { alias: { '#lib': fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	server: { host: '127.0.0.1', port: 5174, strictPort: true }
});
