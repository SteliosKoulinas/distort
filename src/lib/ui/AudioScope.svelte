<script lang="ts">
	import { onMount } from 'svelte';
	import type { AudioEngine } from '#lib/audio/engine';

	interface Props {
		/** Stable reference; the engine is created in the page's onMount. */
		source: { engine: AudioEngine | null };
	}

	let { source }: Props = $props();

	let canvas: HTMLCanvasElement;

	interface ScopeColors {
		ink: string;
		line: string;
	}

	function readColors(): ScopeColors {
		const style = getComputedStyle(document.documentElement);
		return {
			ink: style.getPropertyValue('--ink').trim() || '#10100e',
			line: style.getPropertyValue('--line').trim() || 'rgba(16, 16, 14, 0.16)'
		};
	}

	const MIN_HZ = 30;
	const MAX_HZ = 12_000;
	const DIVIDERS = [160, 2_000];

	function xFor(hz: number, width: number): number {
		return (Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * width;
	}

	onMount(() => {
		const context = canvas.getContext('2d');
		if (!context) return;

		let colors = readColors();
		let raf = 0;

		const lookObserver = new MutationObserver(() => {
			colors = readColors();
		});
		lookObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-look']
		});

		const draw = () => {
			raf = requestAnimationFrame(draw);

			const width = canvas.clientWidth;
			const height = canvas.clientHeight;
			if (width < 4 || height < 4) return;

			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const pixelWidth = Math.round(width * dpr);
			const pixelHeight = Math.round(height * dpr);
			if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
				canvas.width = pixelWidth;
				canvas.height = pixelHeight;
			}

			context.setTransform(dpr, 0, 0, dpr, 0, 0);
			context.clearRect(0, 0, width, height);

			const engine = source.engine;
			const data = engine?.spectrum ?? null;
			const playing = engine?.isPlaying ?? false;
			const binHz = engine?.binHz ?? 48_000 / 2_048;

			const base = height - 1;
			const usable = Math.max(1, height - 6);

			// Band boundaries, kept as hairlines so the spectrum reads as a
			// small instrument rather than a chart.
			context.strokeStyle = colors.line;
			context.lineWidth = 1;
			context.setLineDash([2, 3]);
			for (const hz of DIVIDERS) {
				const x = Math.round(xFor(hz, width)) + 0.5;
				context.beginPath();
				context.moveTo(x, 1);
				context.lineTo(x, base);
				context.stroke();
			}
			context.setLineDash([]);

			context.beginPath();
			context.moveTo(0, base + 0.5);
			context.lineTo(width, base + 0.5);
			context.stroke();

			if (!playing || !data) return;

			const bars = Math.max(24, Math.min(72, Math.round(width / 5)));
			const gap = 1;
			const barWidth = Math.max(1, (width - gap * (bars - 1)) / bars);

			context.fillStyle = colors.ink;
			for (let i = 0; i < bars; i++) {
				const f0 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / bars);
				const f1 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, (i + 1) / bars);
				const from = Math.max(0, Math.floor(f0 / binHz));
				const to = Math.min(data.length - 1, Math.max(from, Math.ceil(f1 / binHz) - 1));

				let peak = 0;
				for (let bin = from; bin <= to; bin++) {
					const value = data[bin] / 255;
					if (value > peak) peak = value;
				}

				const value = Math.pow(peak, 0.85);
				const barHeight = value * usable;
				if (barHeight < 0.4) continue;

				const x = i * (barWidth + gap);
				context.fillRect(x, base - barHeight, barWidth, barHeight);
			}
		};

		raf = requestAnimationFrame(draw);

		return () => {
			cancelAnimationFrame(raf);
			lookObserver.disconnect();
		};
	});
</script>

<canvas bind:this={canvas} class="scope" aria-hidden="true"></canvas>

<style>
	.scope {
		display: block;
		width: 100%;
		height: 54px;
		margin: 8px 0 0;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}
</style>
