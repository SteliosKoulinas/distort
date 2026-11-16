import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	EXPORT_FORMATS,
	MAX_EXPORT_EDGE,
	MIN_EXPORT_EDGE,
	customFormat,
	estimateBytes,
	findFormat,
	normalizeEdge,
	stageFormat
} from '../src/lib/export/formats.ts';

test('every preset is a legal H.264 frame with a real bitrate', () => {
	for (const format of EXPORT_FORMATS) {
		assert.equal(format.width % 2, 0, `${format.id} width must be even`);
		assert.equal(format.height % 2, 0, `${format.id} height must be even`);
		assert.ok(format.width >= MIN_EXPORT_EDGE && format.height >= MIN_EXPORT_EDGE);
		assert.ok(format.bitrate >= 4_000_000);
		assert.match(format.aspect, /^\d+ \/ \d+$/);
	}
});

test('presets keep their delivery sizes', () => {
	assert.deepEqual(
		EXPORT_FORMATS.map((format) => [format.id, format.width, format.height]),
		[
			['reel', 1080, 1920],
			['post', 1080, 1350],
			['square', 1080, 1080],
			['portrait', 1080, 1440],
			['wide', 1920, 1080]
		]
	);
	assert.equal(findFormat('post').width, 1080);
	assert.equal(findFormat('nope').id, 'reel');
});

test('custom sizes snap to even pixels and stay inside the encoder range', () => {
	assert.deepEqual(
		[customFormat(1081, 1351).width, customFormat(1081, 1351).height],
		[1080, 1350]
	);
	assert.deepEqual([customFormat(1, 1).width, customFormat(1, 1).height], [MIN_EXPORT_EDGE, MIN_EXPORT_EDGE]);
	assert.deepEqual(
		[customFormat(9000, 9000).width, customFormat(9000, 9000).height],
		[MAX_EXPORT_EDGE, MAX_EXPORT_EDGE]
	);
	assert.equal(normalizeEdge(0), MIN_EXPORT_EDGE);
	assert.equal(normalizeEdge(Number.NaN), MIN_EXPORT_EDGE);
	assert.equal(normalizeEdge(1079), 1078);
});

test('custom sizes carry their own aspect and bitrate', () => {
	const format = customFormat(1080, 606);
	assert.equal(format.aspect, '1080 / 606');
	assert.equal(format.id, 'custom');
	assert.ok(format.bitrate >= 4_000_000);
});

test('Stage records the on-screen composition at 1080 on the long edge', () => {
	const landscape = stageFormat(695, 517);
	assert.equal(landscape.width, 1080);
	assert.ok(Math.abs(landscape.height - 803) <= 2);
	assert.equal(landscape.height % 2, 0);

	const portrait = stageFormat(390, 693);
	assert.equal(portrait.height, 1080);
	assert.ok(Math.abs(portrait.width - 608) <= 2);

	const square = stageFormat(512, 512);
	assert.deepEqual([square.width, square.height], [1080, 1080]);
	assert.equal(square.id, 'stage');
});

test('estimates grow with size and duration but never divide by zero', () => {
	const square = findFormat('square');
	const reel = findFormat('reel');
	assert.ok(estimateBytes(reel, 60) > estimateBytes(square, 60));
	assert.ok(estimateBytes(square, 120) > estimateBytes(square, 60));
	assert.ok(estimateBytes(square, 0) > 0);
});
