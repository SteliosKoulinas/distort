<script lang="ts">
	import { onMount } from 'svelte';
	import { ParticleField, type FieldStats } from '#lib/gpu/field';
	import { decodeImageFile } from '#lib/image/decode';
	import { analyzeImage, type ImageAnalysis } from '#lib/image/analyze';
	import {
		applyPreset,
		createDefaultParams,
		PRESETS,
		randomizeLook,
		type PresetId,
		type SimParams
	} from '#lib/core/params';
	import {
		PALETTE_MODES,
		paletteCss,
		resolvePalette,
		type PaletteMode
	} from '#lib/core/palette';
	import { mulberry32, randomSeed } from '#lib/core/rng';
	import Section from '#lib/ui/Section.svelte';
	import Slider from '#lib/ui/Slider.svelte';
	import Toggle from '#lib/ui/Toggle.svelte';

	let canvasEl: HTMLCanvasElement;
	let stageEl: HTMLElement;
	let fileEl: HTMLInputElement;
	let field: ParticleField | null = null;

	let params = $state<SimParams>(createDefaultParams());
	let analysis = $state<ImageAnalysis | null>(null);
	let stats = $state<FieldStats | null>(null);
	let fileName = $state('');
	let thumbUrl = $state('');
	let loading = $state(false);
	let errorMessage = $state('');
	let dragActive = $state(false);
	let activePreset = $state<PresetId | 'custom'>('drift');

	let presetNote = $derived(
		activePreset === 'custom'
			? 'Custom parameters.'
			: (PRESETS.find((preset) => preset.id === activePreset)?.note ?? '')
	);
	let palettePair = $derived(analysis ? resolvePalette(params.palette.mode, analysis) : null);

	const fmt2 = (value: number) => value.toFixed(2);
	const fmt1 = (value: number) => value.toFixed(1);
	const fmt3 = (value: number) => value.toFixed(3);
	const fmtHz = (value: number) => `${value.toFixed(2)} Hz`;
	const fmtSigned = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
	const fmtCount = (value: number) => Math.round(value).toLocaleString('en-US');

	let hudCount = $derived(
		stats
			? `${fmtCount(stats.count)} dots`
			: analysis
				? `${fmtCount(params.particleCount)} dots`
				: 'awaiting image'
	);

	onMount(() => {
		let instance: ParticleField;
		try {
			instance = new ParticleField({
				canvas: canvasEl,
				host: stageEl,
				params: $state.snapshot(params),
				onStats: (next) => {
					stats = next;
				},
				onError: (message) => {
					errorMessage = message;
				}
			});
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'WebGL is not available in this browser.';
			return;
		}

		field = instance;
		instance.setParams($state.snapshot(params));

		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.tagName === 'SELECT' ||
					target.isContentEditable)
			) {
				return;
			}

			if (event.code === 'Space') {
				event.preventDefault();
				instance.kick(1);
			} else if (event.key.toLowerCase() === 'r') {
				event.preventDefault();
				instance.reassemble();
			}
		};

		window.addEventListener('keydown', onKeyDown);

		// Browser-only cleanup, returned from onMount. No onDestroy.
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			instance.dispose();
			field = null;
			if (thumbUrl) URL.revokeObjectURL(thumbUrl);
		};
	});

	// The UI writes a plain snapshot on a control change. The animation loop
	// never reads Svelte state; it receives this ordinary object.
	$effect(() => {
		const snapshot = $state.snapshot(params);
		if (field) field.setParams(snapshot);
	});

	async function loadFile(file: File) {
		errorMessage = '';

		if (!file.type.startsWith('image/')) {
			errorMessage = 'That file is not an image.';
			return;
		}
		if (!field) {
			errorMessage = 'The WebGL field is not running.';
			return;
		}

		loading = true;
		try {
			// Let the browser paint the loading state before the synchronous
			// analysis + importance sampling pass.
			await new Promise((resolve) => setTimeout(resolve, 30));

			const nextImage = await decodeImageFile(file, 1200);
			await new Promise((resolve) => setTimeout(resolve, 0));
			const nextAnalysis = analyzeImage(nextImage);

			if (thumbUrl) URL.revokeObjectURL(thumbUrl);
			thumbUrl = URL.createObjectURL(file);
			fileName = file.name;
			analysis = nextAnalysis;

			field.setParams($state.snapshot(params));
			field.setSource(nextAnalysis, nextImage);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Could not read that image.';
		} finally {
			loading = false;
		}
	}

	function onFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) void loadFile(file);
	}

	function resampleNow() {
		if (!field) return;
		field.setParams($state.snapshot(params));
		field.resample();
	}

	function choosePreset(id: PresetId) {
		const preset = PRESETS.find((entry) => entry.id === id);
		if (!preset) return;
		params = applyPreset(params, preset);
		activePreset = id;
		resampleNow();
	}

	function randomize() {
		const rand = mulberry32(randomSeed());
		params = randomizeLook(params, rand);
		activePreset = 'custom';
		resampleNow();
	}

	function randomizeSeed() {
		params.seed = randomSeed();
		resampleNow();
	}

	function choosePalette(mode: PaletteMode) {
		params.palette.mode = mode;
	}

	function triggerLfo(index: number) {
		const lfo = params.lfos[index];
		if (lfo) lfo.enabled = true;
		field?.triggerLfo(index);
	}

	function triggerAllLfos() {
		for (const lfo of params.lfos) lfo.enabled = true;
		field?.triggerAllLfos();
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		dragActive = true;
	}

	function handleDragLeave(event: DragEvent) {
		const related = event.relatedTarget as Node | null;
		if (related && stageEl.contains(related)) return;
		dragActive = false;
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragActive = false;
		const file = event.dataTransfer?.files?.[0];
		if (file) void loadFile(file);
	}
</script>

<svelte:head>
	<title>distort — a portrait in dust</title>
	<meta
		name="description"
		content="An image dissolves into two hundred thousand GPU particles and reassembles. Fine dots on black, slow incompressible drift, a loose spring home."
	/>
</svelte:head>

<input
	bind:this={fileEl}
	class="hidden-input"
	type="file"
	accept="image/*"
	onchange={onFileChange}
	aria-label="Choose an image"
/>

<div class="app">
	<aside class="panel">
		<header class="masthead">
			<div class="wordmark">distort</div>
			<p class="tagline">a portrait in dust</p>
		</header>

		<Section title="Source" kicker="01" open={true}>
			<button class="upload" onclick={() => fileEl.click()} type="button">
				<span>{analysis ? 'Replace image' : 'Choose an image'}</span>
				<span class="upload-plus" aria-hidden="true">+</span>
			</button>

			{#if analysis}
				<div class="preview">
					{#if thumbUrl}
						<img src={thumbUrl} alt="Uploaded source" />
					{/if}
					<div class="preview-meta">
						<span class="filename" title={fileName}>{fileName}</span>
						<span class="dims">{analysis.width} × {analysis.height}</span>
					</div>
				</div>

				{#if analysis.palette.length > 0}
					<div class="palette" aria-label="Dominant hue clusters">
						{#each analysis.palette as swatch}
							<span
								class="swatch"
								style:background={swatch.hex}
								style:flex-grow={Math.max(0.15, swatch.share)}
								title={`${swatch.hex} · ${(swatch.share * 100).toFixed(0)}%`}
							></span>
						{/each}
					</div>
					<div class="palette-caption">dominant hue clusters</div>
				{/if}

				<Slider
					label="Edge detail"
					bind:value={params.edgeBoost}
					min={0}
					max={4}
					step={0.1}
					format={fmt1}
					hint="Weights sampling toward edges. Resamples on release."
					onchange={resampleNow}
				/>

				<div class="grade-block">
					<div class="block-label">Grade</div>
					<div class="chips" role="group" aria-label="Palette">
						{#each PALETTE_MODES as option}
							<button
								type="button"
								class:active={params.palette.mode === option.id}
								onclick={() => choosePalette(option.id)}
							>
								{option.label}
							</button>
						{/each}
					</div>

					{#if palettePair}
						<div
							class="grade-preview"
							style:background={paletteCss(palettePair)}
							aria-hidden="true"
						></div>
					{/if}

					{#if params.palette.mode === 'source'}
						<p class="grade-hint">
							Raw source colour. The additive stage tends to clip multicolour images.
						</p>
					{:else}
						<Slider
							label="Grade amount"
							bind:value={params.palette.amount}
							min={0}
							max={1}
							step={0.01}
							format={fmt2}
							hint="0 keeps the source, 1 is the full two-stop grade."
						/>
						<Slider
							label="Grade chroma"
							bind:value={params.palette.chroma}
							min={0}
							max={1}
							step={0.01}
							format={fmt2}
						/>
						<p class="grade-hint">
							Auto follows the strongest source hue and falls back to bone for black-and-white.
						</p>
					{/if}
				</div>
			{:else}
				<p class="empty-copy">
					Drop a photograph into the stage. It is analysed once, then broken into fine points.
				</p>
			{/if}
		</Section>

		<Section title="Presets" kicker="02" open={true}>
			<div class="presets">
				{#each PRESETS as preset}
					<button
						type="button"
						class:active={activePreset === preset.id}
						onclick={() => choosePreset(preset.id)}
					>
						{preset.name}
					</button>
				{/each}
			</div>
			<p class="preset-note">{presetNote}</p>

			<div class="transport">
				<button type="button" onclick={() => field?.reassemble()} disabled={!analysis}>
					Reassemble <kbd>R</kbd>
				</button>
				<button type="button" onclick={() => field?.kick(1)} disabled={!analysis}>
					Pulse <kbd>space</kbd>
				</button>
			</div>

			<div class="seed-row">
				<label class="seed">
					<span>Seed</span>
					<input
						type="number"
						min="0"
						max="999999"
						bind:value={params.seed}
						onchange={resampleNow}
					/>
				</label>
				<button class="dice" type="button" onclick={randomizeSeed} title="New seed" aria-label="New seed">
					↻
				</button>
			</div>

			<button class="ghost" type="button" onclick={randomize}>Randomize look</button>
		</Section>

		<Section title="Particles" kicker="03" open={true}>
			<Slider
				label="Count"
				bind:value={params.particleCount}
				min={32768}
				max={262144}
				step={64}
				format={fmtCount}
				hint="Up to 512 × 512 on the GPU. Resamples on release."
				onchange={resampleNow}
			/>
			<Slider
				label="Size"
				bind:value={params.pointSize}
				min={0.6}
				max={4}
				step={0.05}
				format={fmt2}
			/>
			<Slider
				label="Opacity"
				bind:value={params.opacity}
				min={0.2}
				max={1}
				step={0.01}
				format={fmt2}
			/>
		</Section>

		<Section title="Flow field" kicker="04" open={true}>
			<Toggle label="Curl noise" bind:checked={params.curlEnabled} />
			<Slider
				label="Strength"
				bind:value={params.curlStrength}
				min={0}
				max={2.5}
				step={0.05}
				format={fmt2}
			/>
			<Slider
				label="Scale"
				bind:value={params.curlScale}
				min={0.4}
				max={4}
				step={0.05}
				format={fmt2}
			/>
			<Slider
				label="Evolution speed"
				bind:value={params.curlSpeed}
				min={0}
				max={0.6}
				step={0.01}
				format={fmt2}
			/>
		</Section>

		<Section title="Return" kicker="05">
			<Toggle label="Spring to origin" bind:checked={params.springEnabled} />
			<Slider
				label="Stiffness"
				bind:value={params.spring}
				min={0}
				max={6}
				step={0.05}
				format={fmt2}
			/>
			<Slider
				label="Damping"
				bind:value={params.damping}
				min={0.8}
				max={0.99}
				step={0.005}
				format={fmt3}
			/>
			<Slider
				label="Speed limit"
				bind:value={params.maxSpeed}
				min={0.5}
				max={8}
				step={0.1}
				format={fmt1}
			/>
		</Section>

		<Section title="Pointer" kicker="06">
			<Toggle label="Pointer force" bind:checked={params.pointerEnabled} />
			<Slider
				label="Attract / repel"
				bind:value={params.pointerStrength}
				min={-4}
				max={4}
				step={0.1}
				format={fmtSigned}
				hint="Positive pulls toward the cursor, negative pushes away."
			/>
			<Slider
				label="Radius"
				bind:value={params.pointerRadius}
				min={0.05}
				max={1}
				step={0.01}
				format={fmt2}
			/>
			<Slider
				label="Swirl"
				bind:value={params.pointerSwirl}
				min={0}
				max={1.5}
				step={0.05}
				format={fmt2}
			/>
		</Section>

		<Section title="Pulse" kicker="07">
			<Toggle label="Radial pulse" bind:checked={params.pulseEnabled} />
			<Toggle
				label="Auto pulse"
				bind:checked={params.autoPulse}
				hint="A metronome in place of live audio. Phase 2 replaces it."
			/>
			<Slider
				label="Strength"
				bind:value={params.pulseStrength}
				min={0}
				max={8}
				step={0.1}
				format={fmt1}
			/>
			<Slider
				label="Radius"
				bind:value={params.pulseRadius}
				min={0.1}
				max={1}
				step={0.01}
				format={fmt2}
			/>
		</Section>

		<Section title="Wave" kicker="08">
			<Toggle label="Traveling ring" bind:checked={params.waveEnabled} />
			<Slider
				label="Strength"
				bind:value={params.waveStrength}
				min={0}
				max={2}
				step={0.05}
				format={fmt2}
			/>
			<Slider
				label="Wavenumber"
				bind:value={params.waveFrequency}
				min={1}
				max={20}
				step={0.5}
				format={fmt1}
			/>
			<Slider
				label="Phase speed"
				bind:value={params.waveSpeed}
				min={0}
				max={6}
				step={0.1}
				format={fmt1}
			/>
		</Section>

		<Section title="Fracture" kicker="09">
			<Toggle
				label="Voronoi shards"
				bind:checked={params.fractureEnabled}
				hint="Particles cluster into jittered cells that drift apart."
			/>
			<Slider
				label="Pull"
				bind:value={params.fractureStrength}
				min={0}
				max={8}
				step={0.1}
				format={fmt1}
			/>
			<Slider
				label="Cell scale"
				bind:value={params.fractureScale}
				min={2}
				max={16}
				step={0.5}
				format={fmt1}
			/>
			<Slider
				label="Cell drift"
				bind:value={params.fractureSpread}
				min={0}
				max={2}
				step={0.05}
				format={fmt2}
			/>
		</Section>

		<Section title="Depth" kicker="10">
			<Toggle
				label="Depth scatter"
				bind:checked={params.depthEnabled}
				hint="Offsets points in screen space and varies their size: a shallow 3D shimmer."
			/>
			<Slider
				label="Amount"
				bind:value={params.depthStrength}
				min={0}
				max={3}
				step={0.05}
				format={fmt2}
			/>
		</Section>

		<Section title="Modulation" kicker="11" open={false}>
			<div class="lfo-head">
				<span>4 routes · retrigger</span>
				<button type="button" class="mini-button" onclick={triggerAllLfos}>Trigger all</button>
			</div>

			{#each params.lfos as lfo, index}
				<div class="lfo" class:off={!lfo.enabled}>
					<div class="lfo-row">
						<span class="lfo-name">LFO {index + 1}</span>
						<select
							bind:value={params.lfos[index].target}
							aria-label={`LFO ${index + 1} target`}
						>
							<option value="curl">Curl</option>
							<option value="scale">Noise scale</option>
							<option value="spring">Spring</option>
							<option value="pointer">Pointer</option>
							<option value="pulse">Pulse</option>
							<option value="wave">Wave</option>
							<option value="fracture">Fracture</option>
							<option value="depth">Depth</option>
							<option value="size">Point size</option>
							<option value="opacity">Opacity</option>
						</select>
						<select
							bind:value={params.lfos[index].shape}
							aria-label={`LFO ${index + 1} shape`}
						>
							<option value="sine">Sine</option>
							<option value="triangle">Triangle</option>
							<option value="ramp">Ramp</option>
							<option value="random">Random</option>
						</select>
						<button
							class="lfo-trigger"
							type="button"
							onclick={() => triggerLfo(index)}
							title={`Retrigger LFO ${index + 1}`}
							aria-label={`Retrigger LFO ${index + 1}`}
						>
							↻
						</button>
						<button
							class="lfo-power"
							class:active={lfo.enabled}
							type="button"
							onclick={() => (params.lfos[index].enabled = !lfo.enabled)}
							aria-label={`Turn LFO ${index + 1} ${lfo.enabled ? 'off' : 'on'}`}
						>
							{lfo.enabled ? 'on' : 'off'}
						</button>
					</div>

					<div class="lfo-sliders">
						<label class="mini-slider">
							<span>Rate <b>{fmtHz(lfo.rate)}</b></span>
							<input
								type="range"
								min="0.01"
								max="1"
								step="0.01"
								bind:value={params.lfos[index].rate}
								aria-label={`LFO ${index + 1} rate`}
							/>
						</label>
						<label class="mini-slider">
							<span>Depth <b>{lfo.depth.toFixed(2)}</b></span>
							<input
								type="range"
								min="0"
								max="1"
								step="0.01"
								bind:value={params.lfos[index].depth}
								aria-label={`LFO ${index + 1} depth`}
							/>
						</label>
					</div>
				</div>
			{/each}

			<p class="lfo-hint">
				Each route multiplies one parameter by <code>1 + signal × depth</code>. Retrigger restarts the
				phase and swells the route back in; phases survive preset changes.
			</p>
		</Section>

		<footer class="panel-footer">
			<p><kbd>space</kbd> pulse · <kbd>R</kbd> reassemble</p>
			<p>
				{stats ? fmtCount(stats.count) : '—'} dots · {stats?.textureSize ?? '—'}² texture ·
				{stats?.precision ?? 'GPU'}
			</p>
		</footer>
	</aside>

	<main
		bind:this={stageEl}
		class="stage"
		class:dragging={dragActive}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
	>
		<canvas bind:this={canvasEl} aria-label="GPU particle field"></canvas>

		<div class="hud" aria-live="off">
			<span>{stats ? stats.fps.toFixed(0) : '—'} fps</span>
			<span class="hud-sep">/</span>
			<span>{hudCount}</span>
		</div>

		{#if !analysis}
			<button class="drop" type="button" onclick={() => fileEl.click()}>
				<span class="drop-kicker">Input</span>
				<span class="drop-title">Drop an image</span>
				<span class="drop-sub">or click to browse · JPG, PNG, WebP</span>
			</button>
		{/if}

		{#if loading}
			<div class="loading" role="status">
				<span class="loading-line"></span>
				<span>sampling the image</span>
			</div>
		{/if}

		{#if errorMessage}
			<div class="error" role="alert">
				<span>{errorMessage}</span>
				<button type="button" onclick={() => (errorMessage = '')} aria-label="Dismiss error">×</button>
			</div>
		{/if}
	</main>
</div>

<style>
	.hidden-input {
		position: fixed;
		width: 1px;
		height: 1px;
		left: -9999px;
		opacity: 0;
		pointer-events: none;
	}

	.app {
		display: grid;
		grid-template-columns: 360px minmax(0, 1fr);
		height: 100dvh;
		overflow: hidden;
		background: var(--bg);
	}

	.panel {
		position: relative;
		z-index: 1;
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 26px 26px 20px;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.018), transparent 180px),
			var(--panel);
		border-right: 1px solid var(--line);
		scrollbar-width: thin;
		scrollbar-color: var(--line-bright) transparent;
	}
	.panel::-webkit-scrollbar {
		width: 5px;
	}
	.panel::-webkit-scrollbar-thumb {
		background: var(--line-bright);
		border-radius: 10px;
	}

	.masthead {
		padding-bottom: 22px;
		border-bottom: 1px solid var(--line);
		margin-bottom: 2px;
	}
	.wordmark {
		font-family: var(--serif);
		font-size: 38px;
		line-height: 0.95;
		letter-spacing: -0.035em;
		font-weight: 400;
	}
	.tagline {
		margin: 8px 0 0;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.upload {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 12px 14px;
		border: 1px solid var(--line-bright);
		border-radius: 2px;
		background: transparent;
		color: var(--paper);
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		transition:
			border-color 150ms ease,
			background 150ms ease;
	}
	.upload:hover {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.upload-plus {
		font-size: 16px;
		line-height: 1;
		color: var(--accent);
	}

	.preview {
		margin-top: 12px;
		border: 1px solid var(--line);
		background: #000;
	}
	.preview img {
		display: block;
		width: 100%;
		max-height: 160px;
		object-fit: cover;
		filter: saturate(0.9) contrast(1.02);
	}
	.preview-meta {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 10px;
		border-top: 1px solid var(--line);
	}
	.filename {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--mono);
		font-size: 9px;
		color: var(--paper-dim);
	}
	.dims {
		flex: 0 0 auto;
		font-family: var(--mono);
		font-size: 9px;
		color: var(--muted);
	}

	.palette {
		display: flex;
		gap: 2px;
		height: 8px;
		margin-top: 10px;
	}
	.swatch {
		min-width: 4px;
		height: 100%;
		border-radius: 1px;
	}
	.palette-caption {
		margin: 6px 0 18px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.grade-block {
		margin-top: 4px;
		padding-top: 14px;
		border-top: 1px solid var(--line);
	}
	.block-label {
		margin-bottom: 8px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.chips {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
	}
	.chips button {
		padding: 7px 4px;
		border: 1px solid var(--line);
		background: var(--panel-raised);
		color: var(--paper-dim);
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		transition:
			border-color 140ms ease,
			color 140ms ease,
			background 140ms ease;
	}
	.chips button:hover {
		border-color: var(--line-bright);
		color: var(--paper);
	}
	.chips button.active {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}
	.grade-preview {
		height: 7px;
		margin: 8px 0 13px;
		border: 1px solid var(--line);
	}
	.grade-hint {
		margin: 0 0 12px;
		font-size: 10px;
		line-height: 1.45;
		color: var(--muted);
	}

	.lfo-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 10px;
	}
	.lfo-head > span {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.mini-button {
		padding: 6px 8px;
		border: 1px solid var(--line-bright);
		background: transparent;
		color: var(--paper-dim);
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		transition:
			border-color 140ms ease,
			color 140ms ease;
	}
	.mini-button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.lfo {
		margin-bottom: 7px;
		padding: 8px 8px 2px;
		border: 1px solid var(--line);
		background: rgba(255, 255, 255, 0.012);
	}
	.lfo.off {
		opacity: 0.5;
	}
	.lfo-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.lfo-name {
		flex: 0 0 auto;
		width: 33px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.lfo select {
		flex: 1 1 0;
		min-width: 0;
		height: 23px;
		padding: 0 2px;
		border: 1px solid var(--line);
		border-radius: 0;
		background: var(--panel-raised);
		color: var(--paper-dim);
		font-family: var(--mono);
		font-size: 8px;
	}
	.lfo-trigger,
	.lfo-power {
		flex: 0 0 auto;
		height: 23px;
		padding: 0;
		border: 1px solid var(--line);
		background: var(--panel-raised);
		color: var(--muted);
		font-family: var(--mono);
		line-height: 1;
		transition:
			border-color 140ms ease,
			color 140ms ease,
			background 140ms ease;
	}
	.lfo-trigger {
		width: 23px;
		font-size: 12px;
	}
	.lfo-power {
		width: 28px;
		font-size: 7px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.lfo-trigger:hover,
	.lfo-power:hover {
		border-color: var(--line-bright);
		color: var(--paper);
	}
	.lfo-power.active {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}
	.lfo-sliders {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-top: 7px;
	}
	.mini-slider {
		display: block;
		margin: 0 0 6px;
	}
	.mini-slider > span {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	.mini-slider b {
		font-weight: 400;
		color: var(--paper-dim);
		font-variant-numeric: tabular-nums;
	}
	.mini-slider input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		display: block;
		width: 100%;
		height: 14px;
		margin: 3px 0 0;
		background: transparent;
		cursor: ew-resize;
	}
	.mini-slider input[type='range']::-webkit-slider-runnable-track {
		height: 1px;
		background: var(--line-bright);
	}
	.mini-slider input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 8px;
		height: 8px;
		margin-top: -3.5px;
		border-radius: 50%;
		background: var(--paper);
		box-shadow: 0 0 0 2px var(--panel);
	}
	.mini-slider input[type='range']:hover::-webkit-slider-thumb {
		background: var(--accent);
	}
	.mini-slider input[type='range']::-moz-range-track {
		height: 1px;
		background: var(--line-bright);
	}
	.mini-slider input[type='range']::-moz-range-thumb {
		width: 8px;
		height: 8px;
		border: 0;
		border-radius: 50%;
		background: var(--paper);
	}
	.lfo-hint {
		margin: 2px 0 12px;
		font-size: 10px;
		line-height: 1.5;
		color: var(--muted);
	}
	.lfo-hint code {
		font-family: var(--mono);
		font-size: 9px;
		color: var(--paper-dim);
	}

	.empty-copy {
		margin: 14px 0 0;
		font-size: 11px;
		line-height: 1.55;
		color: var(--muted);
	}

	.presets {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 5px;
	}
	.presets button,
	.transport button,
	.ghost,
	.dice {
		border: 1px solid var(--line);
		background: var(--panel-raised);
		color: var(--paper-dim);
		transition:
			border-color 140ms ease,
			color 140ms ease,
			background 140ms ease;
	}
	.presets button {
		padding: 9px 4px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}
	.presets button:hover,
	.transport button:hover:not(:disabled),
	.ghost:hover,
	.dice:hover {
		border-color: var(--line-bright);
		color: var(--paper);
	}
	.presets button.active {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}
	.preset-note {
		min-height: 32px;
		margin: 10px 0 13px;
		font-size: 10px;
		line-height: 1.5;
		color: var(--muted);
	}

	.transport {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 5px;
		margin-bottom: 12px;
	}
	.transport button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 9px 10px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.transport button:disabled,
	.ghost:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.seed-row {
		display: flex;
		gap: 5px;
		margin-bottom: 6px;
	}
	.seed {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 8px;
		padding: 7px 9px;
		border: 1px solid var(--line);
		background: transparent;
	}
	.seed span {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.seed input {
		width: 100%;
		min-width: 0;
		border: 0;
		outline: 0;
		background: transparent;
		font-family: var(--mono);
		font-size: 10px;
		color: var(--paper);
	}
	.dice {
		width: 34px;
		font-size: 15px;
		line-height: 1;
	}
	.ghost {
		width: 100%;
		padding: 8px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		background: transparent;
	}

	.panel-footer {
		margin-top: 18px;
		padding-top: 14px;
		border-top: 1px solid var(--line);
	}
	.panel-footer p {
		margin: 0 0 5px;
		font-family: var(--mono);
		font-size: 8px;
		line-height: 1.5;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	kbd {
		padding: 1px 4px;
		border: 1px solid var(--line-bright);
		border-radius: 2px;
		font-family: var(--mono);
		font-size: 8px;
		color: var(--paper-dim);
	}

	.stage {
		position: relative;
		min-width: 0;
		overflow: hidden;
		background: var(--bg);
	}
	.stage canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		touch-action: none;
	}
	.stage::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
		background: radial-gradient(circle at 50% 48%, transparent 38%, rgba(0, 0, 0, 0.28) 100%);
	}
	.stage.dragging::before {
		content: '';
		position: absolute;
		inset: 18px;
		z-index: 4;
		border: 1px solid var(--accent);
		background: rgba(217, 162, 75, 0.04);
		pointer-events: none;
	}

	.hud {
		position: absolute;
		top: 18px;
		right: 20px;
		z-index: 3;
		display: flex;
		gap: 7px;
		padding: 6px 8px;
		border: 1px solid rgba(255, 255, 255, 0.06);
		background: rgba(7, 7, 6, 0.55);
		backdrop-filter: blur(6px);
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.hud-sep {
		color: var(--line-bright);
	}

	.drop {
		position: absolute;
		inset: 22px;
		z-index: 3;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		border: 1px dashed var(--line-bright);
		background: radial-gradient(circle at 50% 45%, rgba(217, 162, 75, 0.05), transparent 60%);
		color: var(--paper);
		transition:
			border-color 160ms ease,
			background 160ms ease;
	}
	.drop:hover {
		border-color: var(--accent);
		background: radial-gradient(circle at 50% 45%, rgba(217, 162, 75, 0.09), transparent 62%);
	}
	.drop-kicker {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.drop-title {
		font-family: var(--serif);
		font-size: clamp(32px, 5vw, 64px);
		font-weight: 400;
		letter-spacing: -0.035em;
	}
	.drop-sub {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.loading {
		position: absolute;
		inset: 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		background: rgba(7, 7, 6, 0.7);
		backdrop-filter: blur(3px);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--paper-dim);
	}
	.loading-line {
		width: 120px;
		height: 1px;
		background: linear-gradient(90deg, transparent, var(--accent), transparent);
		animation: sweep 1.1s ease-in-out infinite;
	}
	@keyframes sweep {
		0%,
		100% {
			opacity: 0.25;
			transform: scaleX(0.45);
		}
		50% {
			opacity: 1;
			transform: scaleX(1);
		}
	}

	.error {
		position: absolute;
		left: 50%;
		bottom: 22px;
		z-index: 6;
		display: flex;
		align-items: center;
		gap: 14px;
		max-width: min(520px, calc(100% - 44px));
		padding: 10px 12px;
		border: 1px solid rgba(208, 106, 85, 0.55);
		background: rgba(34, 15, 12, 0.94);
		font-size: 11px;
		line-height: 1.45;
		color: #f0c6bc;
		transform: translateX(-50%);
	}
	.error button {
		border: 0;
		background: transparent;
		color: #f0c6bc;
		font-size: 16px;
		line-height: 1;
	}

	@media (max-width: 860px) {
		.app {
			grid-template-columns: 1fr;
			grid-template-rows: 52dvh 48dvh;
		}
		.stage {
			order: 1;
		}
		.panel {
			order: 2;
			height: auto;
			border-right: 0;
			border-top: 1px solid var(--line);
			padding: 20px 20px 18px;
		}
		.masthead {
			padding-bottom: 16px;
		}
		.wordmark {
			font-size: 30px;
		}
		.presets {
			grid-template-columns: repeat(5, 1fr);
		}
		.drop {
			inset: 12px;
		}
		.drop-title {
			font-size: clamp(28px, 9vw, 44px);
		}
		.drop-sub {
			font-size: 8px;
		}
	}
</style>
