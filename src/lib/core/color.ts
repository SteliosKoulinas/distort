/** Colour helpers shared by the sampler, palette resolver and shader wiring. */

export function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToSrgbRgb(hex: string): [number, number, number] {
	const value = hex.replace('#', '');
	const int = Number.parseInt(value.length === 3 ? value.replace(/(.)/g, '$1$1') : value, 16);
	return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function hexToLinearRgb(hex: string): [number, number, number] {
	const [r, g, b] = hexToSrgbRgb(hex);
	return [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
}

/** h, s, l in 0..1. Returns #rrggbb. */
export function hslToHex(h: number, s: number, l: number): string {
	const hue = ((h % 1) + 1) % 1;
	const sat = Math.max(0, Math.min(1, s));
	const light = Math.max(0, Math.min(1, l));

	const c = (1 - Math.abs(2 * light - 1)) * sat;
	const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
	const m = light - c / 2;

	let r = 0;
	let g = 0;
	let b = 0;
	if (hue < 1 / 6) [r, g, b] = [c, x, 0];
	else if (hue < 2 / 6) [r, g, b] = [x, c, 0];
	else if (hue < 3 / 6) [r, g, b] = [0, c, x];
	else if (hue < 4 / 6) [r, g, b] = [0, x, c];
	else if (hue < 5 / 6) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];

	const byte = (n: number) =>
		Math.round(Math.max(0, Math.min(1, n + m)) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${byte(r)}${byte(g)}${byte(b)}`;
}
