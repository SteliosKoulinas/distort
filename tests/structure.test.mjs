import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeImage } from '../src/lib/image/analyze.ts';
import { buildStructureField } from '../src/lib/image/structure.ts';

function image(width, height, pixel) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			const value = pixel(x, y);
			data[offset] = value;
			data[offset + 1] = value;
			data[offset + 2] = value;
			data[offset + 3] = 255;
		}
	}
	return { imageData: { data, width, height }, width, height, aspect: width / height };
}

test('structure field preserves source dimensions and normalized arrays', () => {
	const source = analyzeImage(image(12, 8, (x, y) => (x + y) * 8));
	const field = buildStructureField(source);
	assert.equal(field.width, 12);
	assert.equal(field.height, 8);
	assert.equal(field.orientation.length, 96);
	assert.equal(field.coherence.length, 96);
	assert.equal(field.gradient.length, 96);
	for (const value of field.coherence) assert.ok(value >= 0 && value <= 1);
});

test('a constant image has no directional coherence', () => {
	const source = analyzeImage(image(12, 8, () => 80));
	const field = buildStructureField(source);
	assert.equal(Math.max(...field.coherence), 0);
	assert.equal(Math.max(...field.gradient), 0);
});

for (const axis of ['x', 'y', 'diagonal']) {
	test(`${axis} ramp has perpendicular gradient and contour directions`, () => {
		const analysis = analyzeImage(image(16, 16, (x, y) =>
			axis === 'x' ? x * 12 : axis === 'y' ? y * 12 : (x + y) * 6));
		const field = buildStructureField(analysis);
		const i = 8 * 16 + 8;
		const gx = field.gradientDir.x[i], gy = field.gradientDir.y[i];
		const cx = field.contourDir.x[i], cy = field.contourDir.y[i];
		assert.ok(field.coherence[i] > 0.99);
		assert.ok(Math.abs(gx * cx + gy * cy) < 1e-6);
		assert.ok(Math.abs(analysis.sobelX[i] * cy - analysis.sobelY[i] * cx) > 0.1);
		if (axis === 'x') assert.ok(Math.abs(cx) < 1e-6);
		if (axis === 'y') assert.ok(Math.abs(cy) < 1e-6);
		if (axis === 'diagonal') assert.ok(Math.abs(gx - gy) < 1e-6);
	});
}
