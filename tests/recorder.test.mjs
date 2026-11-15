import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameRecorder } from '../src/lib/export/recorder.ts';

// Exercise the recorder against display rates and encoder failures that are
// difficult to reproduce reliably by hand. Actual MP4/AAC decoding is checked
// separately in a browser, since Node has no WebCodecs video implementation.
function stubGlobal(t, name, value) {
	const previous = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
	t.after(() => {
		if (previous) Object.defineProperty(globalThis, name, previous);
		else delete globalThis[name];
	});
}

function harness(t) {
	let now = 0;
	const frames = [];
	const encoders = [];
	t.mock.method(performance, 'now', () => now);
	stubGlobal(t, 'VideoFrame', class {
		constructor(source, init) {
			this.source = source.source ?? source;
			Object.assign(this, init);
		}
		close() { this.closed = true; }
	});
	stubGlobal(t, 'VideoEncoder', class {
		static async isConfigSupported() { return { supported: true }; }
		state = 'unconfigured';
		encodeQueueSize = 0;
		constructor(callbacks) { this.callbacks = callbacks; encoders.push(this); }
		configure() { this.state = 'configured'; }
		encode(frame) { frames.push(frame); }
		async flush() {}
		close() { this.state = 'closed'; }
	});
	return {
		frames, encoders,
		at(ms) { now = ms; },
		options: {
			canvas: { source: 'canvas' }, audioStream: null,
			width: 1080, height: 1920, fps: 30, bitrate: 17_400_000, sampleRate: 48000
		}
	};
}

test('a 100 Hz display produces 30 evenly timed, closed video frames per second', async (t) => {
	const h = harness(t);
	const recorder = await FrameRecorder.create({ ...h.options, duration: 1 });
	for (let ms = 0; ms < 1100; ms += 10) {
		h.at(ms);
		recorder.pushFrame(h.options.canvas);
	}
	assert.equal(h.frames.length, 30);
	for (let i = 0; i < h.frames.length; i++) {
		assert.equal(h.frames[i].timestamp, Math.round(i * 1_000_000 / 30));
		assert.equal(h.frames[i].duration, Math.round((i + 1) * 1_000_000 / 30) - h.frames[i].timestamp);
		assert.equal(h.frames[i].closed, true);
	}
	recorder.abort();
	assert.equal(h.encoders[0].state, 'closed');
});

test('missed display frames hold the last image instead of shortening the take', async (t) => {
	const h = harness(t);
	const recorder = await FrameRecorder.create(h.options);
	recorder.pushFrame({ source: 'first' });
	h.at(180);
	recorder.pushFrame({ source: 'second' });
	assert.deepEqual(h.frames.map((f) => f.source), ['first', 'first', 'first', 'first', 'first', 'second']);
	assert.equal(h.frames[5].timestamp, 166667);
	recorder.abort();
});

test('asynchronous encoder failures are reported and resources can be released', async (t) => {
	const h = harness(t);
	const recorder = await FrameRecorder.create(h.options);
	h.encoders[0].callbacks.error(new Error('Hardware encoder lost'));
	assert.throws(() => recorder.pushFrame(h.options.canvas), /Hardware encoder lost/);
	await assert.rejects(recorder.stop(), /Hardware encoder lost/);
	assert.equal(h.encoders[0].state, 'closed');
});

test('long rendering stalls fail explicitly instead of silently exporting broken timing', async (t) => {
	const h = harness(t);
	const recorder = await FrameRecorder.create(h.options);
	recorder.pushFrame(h.options.canvas);
	h.at(4000);
	assert.throws(() => recorder.pushFrame(h.options.canvas), /fell behind/);
	recorder.abort();
});
