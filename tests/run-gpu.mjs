import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const candidates = [
	process.env.CHROME_PATH,
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'
].filter(Boolean);
let chrome;
for (const candidate of candidates) {
	try { await access(candidate); chrome = candidate; break; } catch {}
}
if (!chrome) throw new Error('GPU tests require Chrome/Chromium. Set CHROME_PATH to its executable.');

const server = await createServer({
	configFile: 'vite.gpu.config.ts',
	server: { host: '127.0.0.1', port: 0, strictPort: false }
});
const profile = await mkdtemp(join(tmpdir(), 'distort-gpu-'));
let browser;
let socket;
let timer;
try {
	await server.listen();
	const address = server.httpServer.address();
	const url = `http://127.0.0.1:${address.port}/tests/visual-engines.html`;
	browser = spawn(chrome, [
		'--headless=new', '--no-first-run', '--no-default-browser-check',
		'--disable-background-networking', '--disable-component-update', '--disable-sync',
		'--disable-default-apps', '--no-pings', '--metrics-recording-only',
		`--user-data-dir=${profile}`, '--remote-debugging-port=0',
		'--remote-debugging-address=127.0.0.1', 'about:blank'
	], { stdio: ['ignore', 'ignore', 'pipe'] });
	const run = async () => {
		const endpoint = await new Promise((resolve, reject) => {
			let stderr = '';
			browser.stderr.on('data', (data) => {
				stderr += data;
				const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
				if (match) resolve(match[1]);
			});
			browser.once('error', reject);
			browser.once('exit', (code) => reject(new Error(`Chrome exited (${code}): ${stderr}`)));
		});
		socket = new WebSocket(endpoint);
		await new Promise((resolve, reject) => {
			socket.addEventListener('open', resolve, { once: true });
			socket.addEventListener('error', reject, { once: true });
		});
		let sequence = 0;
		const pending = new Map();
		const events = new Map();
		socket.addEventListener('message', ({ data }) => {
			const message = JSON.parse(data);
			if (message.id) {
				const job = pending.get(message.id);
				pending.delete(message.id);
				if (message.error) job?.reject(new Error(JSON.stringify(message.error)));
				else job?.resolve(message.result);
			} else {
				events.get(message.method)?.(message);
			}
		});
		const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
			const id = ++sequence;
			pending.set(id, { resolve, reject });
			socket.send(JSON.stringify({ id, method, params, sessionId }));
		});
		const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
		const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
		await send('Page.enable', {}, sessionId);
		const loaded = new Promise((resolve) => events.set('Page.loadEventFired', resolve));
		await send('Page.navigate', { url }, sessionId);
		await loaded;
		const response = await send('Runtime.evaluate', {
			expression: 'window.testPromise', awaitPromise: true, returnByValue: true
		}, sessionId);
		const result = response.result?.value;
		if (response.exceptionDetails || !result?.passed || result.error) {
			throw new Error(`GPU tests failed: ${JSON.stringify(result ?? response, null, 2)}`);
		}
		console.log(`${result.passed} GPU checks passed.`);
		for (const test of result.results) console.log(`✓ ${test.name}`);
		console.log('1200px structure timings (ms):', result.timings);
	};
	await Promise.race([
		run(),
		new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('GPU tests timed out.')), 120_000); })
	]);
} finally {
	clearTimeout(timer);
	socket?.close();
	if (browser && browser.exitCode === null) {
		const exited = new Promise((resolve) => browser.once('exit', resolve));
		browser.kill();
		await exited;
	}
	await server.close();
	await rm(profile, { recursive: true, force: true });
}
