import assert from 'node:assert/strict';
import { test } from 'node:test';
import { takeSeconds } from '../src/lib/export/duration.ts';

test('fixed and custom take lengths do not end when a short track ends', () => {
	assert.equal(takeSeconds(60, 90, 30, true), 60);
	assert.equal(takeSeconds(120, 90, 30, true), 120);
	assert.equal(takeSeconds(-1, 91, 30, true), 91);
});

test('Track follows the file only when selected and caps at five minutes', () => {
	assert.equal(takeSeconds(0, 90, 30, true), 30);
	assert.equal(takeSeconds(0, 90, 0, false), 60);
	assert.equal(takeSeconds(0, 90, 400, true), 300);
	assert.equal(takeSeconds(-1, 1000, 0, false), 300);
});
