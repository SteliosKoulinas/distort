import type { ImageAnalysis } from '#lib/image/analyze';
import { hslToHex } from './color';

/**
 * A palette is a two-stop grade, dark → light, applied per particle by the
 * render shader. It keeps the image's luminance structure but replaces its
 * colour with a single coherent family. That is the difference between a
 * multicolour photo fighting a black stage and a portrait that sits on it.
 */
export type PaletteMode = 'auto' | 'source' | 'bone' | 'ember' | 'ice' | 'rose';

export interface PalettePair {
	dark: string;
	light: string;
}

export const PALETTE_MODES: { id: PaletteMode; label: string }[] = [
	{ id: 'auto', label: 'Auto' },
	{ id: 'source', label: 'Source' },
	{ id: 'bone', label: 'Bone' },
	{ id: 'ember', label: 'Ember' },
	{ id: 'ice', label: 'Ice' },
	{ id: 'rose', label: 'Rose' }
];

const CURATED: Record<'bone' | 'ember' | 'ice' | 'rose', PalettePair> = {
	bone: { dark: '#12100c', light: '#f2e7d2' },
	ember: { dark: '#2a0c05', light: '#ffc27a' },
	ice: { dark: '#08141f', light: '#cfe9ff' },
	rose: { dark: '#210a14', light: '#ffd2df' }
};

/**
 * `auto` follows the image's dominant hue but narrows it: a deep, nearly black
 * shadow and a desaturated highlight. Low-saturation sources (black and white,
 * most documents, night shots) fall back to warm bone, which is the most
 * reliable look on this stage.
 */
export function resolvePalette(mode: PaletteMode, analysis: ImageAnalysis): PalettePair {
	if (mode === 'source') return { dark: '#000000', light: '#ffffff' };
	if (mode !== 'auto') return CURATED[mode];

	const hue = analysis.dominantHue;
	if (hue === null || analysis.meanSat < 0.07) return CURATED.bone;

	// Greens are the one family that reads as accidental on a warm black stage.
	// Nudge them toward teal without abandoning the source hue entirely.
	const shifted = hue > 0.2 && hue < 0.44 ? 0.48 + (hue - 0.2) * 0.4 : hue;

	return {
		dark: hslToHex(shifted, 0.62, 0.055),
		light: hslToHex(shifted + 0.025, 0.24, 0.88)
	};
}

/**
 * Percentile levels in linear light. Using p15/p85 instead of 0/1 stops a few
 * specular pixels from flattening the whole grade into the highlight stop.
 */
export function paletteLevels(analysis: ImageAnalysis): { low: number; high: number } {
	const low = Math.max(0.0015, Math.pow(analysis.lumP15, 2.2));
	const high = Math.max(low + 0.035, Math.pow(analysis.lumP85, 2.2));
	return { low, high };
}

export function paletteCss(pair: PalettePair): string {
	return `linear-gradient(90deg, ${pair.dark}, ${pair.light})`;
}
