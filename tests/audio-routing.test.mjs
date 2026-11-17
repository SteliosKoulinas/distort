import assert from 'node:assert/strict';
import { test } from 'node:test';
import { silentAudioFrame } from '../src/lib/audio/types.ts';

test('silent audio frames remain compatible with the legacy five-number route', () => {
	const frame = silentAudioFrame();
	assert.deepEqual(
		{ bass: frame.bass, mid: frame.mid, treble: frame.treble, amp: frame.amp, beat: frame.beat },
		{ bass: 0, mid: 0, treble: 0, amp: 0, beat: 0 }
	);
	assert.equal(frame.features, undefined);
});
