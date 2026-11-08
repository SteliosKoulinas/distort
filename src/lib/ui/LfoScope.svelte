<script lang="ts">
	import { onMount } from 'svelte';
	import { createRandomTable, lfoSignal } from '#lib/core/lfo';
	import type { LfoShape } from '#lib/core/params';
	import type { ParticleField } from '#lib/gpu/field';

	interface Props {
		/** Stable reference; the field is assigned after mount. */
		source: { field: ParticleField | null };
		index: number;
		shape: LfoShape;
		rate: number;
		depth: number;
		enabled: boolean;
	}

	let { source, index, shape, rate, depth, enabled }: Props = $props();

	let canvas: HTMLCanvasElement;

	interface ScopeColors {
		ink: string;
		muted: string;
		line: string;
	}

	function readColors(): ScopeColors {
		const style = getComputedStyle(document.documentElement);
		return {
			ink: style.getPropertyValue('--ink').trim() || '#10100e',
			muted: style.getPropertyValue('--muted').trim() || '#76746b',
			line: style.getPropertyValue('--line').trim() || 'rgba(16, 16, 14, 0.16)'
		};
	}

	onMount(() => {
		const context = canvas.getContext('2d');
		if (!context) return;

		let colors = readColors();
		let localPhase = index * 0.19;
		const fallbackTable = createRandomTable(index);
		let last = performance.now();
		let raf = 0;

		// The look swaps CSS variables; redraw with the new ink on the next frame.
		const lookObserver = new MutationObserver(() => {
			colors = readColors();
		});
		lookObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-look']
		});

		const draw = (now: number) => {
			raf = requestAnimationFrame(draw);

			const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
			last = now;

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

			// Read the runtime by plain property access. The GPU clock is the
			// source of truth once the field exists; before that, keep a local
			// phase so the display still moves.
			const view = source.field?.getLfoView(index) ?? null;
			let phase: number;
			let signal: number;
			let env: number;
			let table: Float32Array;
			if (view) {
				phase = view.phase;
				signal = view.signal;
				env = view.env;
				table = view.table;
			} else {
				localPhase = (localPhase + dt * rate) % 1;
				phase = localPhase;
				signal = lfoSignal(shape, phase, fallbackTable);
				env = 1;
				table = fallbackTable;
			}

			const mid = height / 2;
			const pad = 3;
			const full = Math.max(1, height / 2 - pad);
			const active = full * Math.min(1, Math.max(0, depth));

			// Centre axis.
			context.strokeStyle = colors.line;
			context.lineWidth = 1;
			context.beginPath();
			context.moveTo(0, mid + 0.5);
			context.lineTo(width, mid + 0.5);
			context.stroke();

			// Full-scale ghost: the shape stays readable even at low depth.
			context.beginPath();
			for (let x = 0; x <= width; x++) {
				const y = mid - lfoSignal(shape, x / width, table) * full;
				if (x === 0) context.moveTo(x, y);
				else context.lineTo(x, y);
			}
			context.stroke();

			// The actual depth-scaled wave.
			context.strokeStyle = enabled ? colors.ink : colors.muted;
			context.lineWidth = 1.25;
			context.beginPath();
			for (let x = 0; x <= width; x++) {
				const y = mid - lfoSignal(shape, x / width, table) * active;
				if (x === 0) context.moveTo(x, y);
				else context.lineTo(x, y);
			}
			context.stroke();

			if (!enabled) return;

			// Playhead and the live value on the curve.
			const head = Math.min(width - 0.5, phase * width);
			context.strokeStyle = colors.line;
			context.lineWidth = 1;
			context.beginPath();
			context.moveTo(head + 0.5, 1);
			context.lineTo(head + 0.5, height - 1);
			context.stroke();

			const dotY = mid - signal * env * active;
			context.fillStyle = colors.ink;
			context.beginPath();
			context.arc(head, dotY, 2.4, 0, Math.PI * 2);
			context.fill();
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
		height: 34px;
		margin: 6px 0 2px;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}
</style>
