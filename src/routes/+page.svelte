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
	let clock = $state('--:--');
	let look = $state<'light' | 'dark'>('light');

	function setLook(next: 'light' | 'dark') {
		look = next;
		if (next === 'dark') {
			document.documentElement.dataset.look = 'dark';
		} else {
			delete document.documentElement.dataset.look;
		}
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', next === 'dark' ? '#0e0e0c' : '#f2f0ea');
		try {
			localStorage.setItem('distort-look', next);
		} catch {
			/* private mode */
		}
	}

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
		look = document.documentElement.dataset.look === 'dark' ? 'dark' : 'light';
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', look === 'dark' ? '#0e0e0c' : '#f2f0ea');

		const tickClock = () => {
			clock = new Intl.DateTimeFormat('en-GB', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false
			}).format(new Date());
		};
		tickClock();
		const clockTimer = window.setInterval(tickClock, 30_000);

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
			return () => window.clearInterval(clockTimer);
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
			window.clearInterval(clockTimer);
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

<div class="frame">
	<header class="masthead">
		<div class="brand">
			<a class="brand-name" href="/">Distort</a>
			<span class="brand-sub">A portrait in dust</span>
		</div>
		<div class="mast-meta" aria-hidden="true">
			<span>Image → particle field</span>
			<span>Phase 01 / 02</span>
		</div>
		<div class="mast-stats">
			<span>{stats ? `${stats.fps.toFixed(0)} fps` : '— fps'}</span>
			<span>{stats ? `${fmtCount(stats.count)} dots` : '— dots'}</span>
			<span>{clock} local</span>
			<div class="look" role="group" aria-label="Look">
				<button
					type="button"
					class:active={look === 'light'}
					aria-pressed={look === 'light'}
					onclick={() => setLook('light')}
				>
					Light
				</button>
				<button
					type="button"
					class:active={look === 'dark'}
					aria-pressed={look === 'dark'}
					onclick={() => setLook('dark')}
				>
					Dark
				</button>
			</div>
		</div>
	</header>

	<div class="app">
		<aside class="panel" aria-label="Controls">
			<div class="panel-head">
				<div class="panel-eyebrow"><span>( 01 — Instrument )</span><span>WebGL / 2D</span></div>
				<h1 class="panel-title">An image,<br />in dust.</h1>
				<p class="panel-lede">
					A photograph is sampled into <strong>{fmtCount(params.particleCount)}</strong> points and held
					in a slow field. Move the pointer to pull it apart; let go to bring it home.
				</p>
				<div class="panel-spec">
					<span><b>{stats ? fmtCount(stats.count) : fmtCount(params.particleCount)}</b> points</span>
					<span><b>{stats?.textureSize ?? '—'}</b>² grid</span>
					<span><b>{stats?.precision ?? 'GPU'}</b> buffer</span>
				</div>
			</div>

			<Section title="Source" kicker="01" open={true}>
				<button class="upload" onclick={() => fileEl.click()} type="button">
					<span>{analysis ? 'Replace image' : 'Choose an image'}</span>
					<span class="upload-plus" aria-hidden="true">{analysis ? '↺' : '+'}</span>
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
						<div class="palette-caption">Dominant hue clusters</div>
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
						<div class="block-label"><span>Grade</span><span>{params.palette.mode}</span></div>
						<div class="chips" role="group" aria-label="Palette">
							{#each PALETTE_MODES as option}
								<button
									type="button"
									class:active={params.palette.mode === option.id}
									aria-pressed={params.palette.mode === option.id}
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
					{#each PRESETS as preset, index}
						<button
							type="button"
							class:active={activePreset === preset.id}
							aria-pressed={activePreset === preset.id}
							onclick={() => choosePreset(preset.id)}
						>
							<span class="preset-index">{String(index + 1).padStart(2, '0')}</span>
							<span class="preset-name">{preset.name}</span>
							<span class="preset-mark" aria-hidden="true">
								{activePreset === preset.id ? '—' : '+'}
							</span>
						</button>
					{/each}
				</div>
				<p class="preset-note">{presetNote}</p>

				<div class="transport">
					<button type="button" onclick={() => field?.reassemble()} disabled={!analysis}>
						<span>Reassemble</span><kbd>R</kbd>
					</button>
					<button type="button" onclick={() => field?.kick(1)} disabled={!analysis}>
						<span>Pulse</span><kbd>Space</kbd>
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
							<span class="lfo-name">LFO {String(index + 1).padStart(2, '0')}</span>
							<select
								bind:value={params.lfos[index].target}
								aria-label={`LFO ${index + 1} target`}
							>
								<option value="curl">Curl</option>
								<option value="scale">Scale</option>
								<option value="spring">Spring</option>
								<option value="pointer">Pointer</option>
								<option value="pulse">Pulse</option>
								<option value="wave">Wave</option>
								<option value="fracture">Fracture</option>
								<option value="depth">Depth</option>
								<option value="size">Size</option>
								<option value="opacity">Opacity</option>
							</select>
							<select
								bind:value={params.lfos[index].shape}
								aria-label={`LFO ${index + 1} shape`}
							>
								<option value="sine">Sine</option>
								<option value="triangle">Tri</option>
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
					Each route multiplies one parameter by <code>1 + signal × depth</code>. Retrigger restarts
					the phase and swells the route back in; phases survive preset changes.
				</p>
			</Section>

			<footer class="panel-footer">
				<p><kbd>Space</kbd> pulse <span aria-hidden="true">/</span> <kbd>R</kbd> reassemble</p>
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

			<div class="ticks" aria-hidden="true"><i></i><i></i><i></i><i></i></div>

			<div class="stage-line stage-line-top">
				<span>Fig. 01 — Portrait in dust</span>
				<span class="hud" aria-live="off">
					{stats ? stats.fps.toFixed(0) : '—'} fps / {hudCount}
				</span>
			</div>

			<div class="stage-line stage-line-bottom">
				<span>{analysis ? 'Move pointer to distort' : 'Input — JPG / PNG / WebP'}</span>
				<span>
					{stats ? `${stats.textureSize}² / ${stats.precision}` : 'WebGL2 / render-to-float'}
				</span>
			</div>

			{#if !analysis}
				<button class="drop" type="button" onclick={() => fileEl.click()}>
					<span class="drop-top"><span>Input / 00</span><span aria-hidden="true">+</span></span>
					<span class="drop-title">Drop<br />an image</span>
					<span class="drop-sub">JPG · PNG · WebP — click to browse</span>
				</button>
			{/if}

			{#if loading}
				<div class="loading" role="status">
					<span class="loading-line"></span>
					<span>Sampling image</span>
				</div>
			{/if}

			{#if errorMessage}
				<div class="error" role="alert">
					<span><b>Error</b> — {errorMessage}</span>
					<button type="button" onclick={() => (errorMessage = '')} aria-label="Dismiss error">×</button>
				</div>
			{/if}
		</main>
	</div>
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

	.frame {
		height: calc(100dvh - 20px);
		margin: 10px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--ink);
		background: var(--paper);
	}

	.masthead {
		flex: 0 0 54px;
		display: flex;
		align-items: stretch;
		justify-content: space-between;
		min-width: 0;
		border-bottom: 1px solid var(--ink);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		padding: 0 16px;
	}
	.brand-name {
		font-family: var(--sans);
		font-size: 22px;
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.045em;
		text-transform: uppercase;
		text-decoration: none;
	}
	.brand-sub {
		padding-left: 12px;
		border-left: 1px solid var(--line);
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--muted);
		white-space: nowrap;
	}
	.mast-meta,
	.mast-stats {
		display: flex;
		align-items: stretch;
		min-width: 0;
	}
	.mast-meta span,
	.mast-stats span {
		display: flex;
		align-items: center;
		padding: 0 13px;
		border-left: 1px solid var(--line);
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--muted);
		white-space: nowrap;
	}
	.mast-stats span:last-of-type {
		color: var(--ink);
	}
	.look {
		display: flex;
		align-items: stretch;
		border-left: 1px solid var(--line);
	}
	.look button {
		padding: 0 11px;
		border: 0;
		background: transparent;
		color: var(--muted);
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.look button + button {
		border-left: 1px solid var(--line);
	}
	.look button:hover {
		color: var(--ink);
	}
	.look button.active {
		background: var(--ink);
		color: var(--paper);
	}

	.app {
		display: grid;
		grid-template-columns: clamp(330px, 26vw, 400px) minmax(0, 1fr);
		flex: 1;
		min-height: 0;
		overflow: hidden;
		background: var(--paper);
	}

	.panel {
		position: relative;
		z-index: 1;
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0 17px 24px;
		background: var(--paper);
		border-right: 1px solid var(--ink);
		scrollbar-width: thin;
		scrollbar-color: var(--line-strong) transparent;
	}
	.panel::-webkit-scrollbar {
		width: 4px;
	}
	.panel::-webkit-scrollbar-thumb {
		background: var(--line-strong);
	}

	.panel-head {
		padding: 18px 0 9px;
	}
	.panel-eyebrow {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 25px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.panel-title {
		margin: 0;
		font-family: var(--sans);
		font-size: clamp(30px, 2.75vw, 38px);
		font-weight: 500;
		line-height: 0.88;
		letter-spacing: -0.055em;
		text-transform: uppercase;
	}
	.panel-lede {
		margin: 15px 0 0;
		font-family: var(--mono);
		font-size: 9px;
		line-height: 1.58;
		letter-spacing: 0.005em;
		text-transform: uppercase;
		text-align: justify;
		text-align-last: left;
		color: var(--ink-soft);
	}
	.panel-lede strong {
		font-weight: 500;
	}
	.panel-spec {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin-top: 18px;
		border-top: 1px solid var(--line);
	}
	.panel-spec span {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 8px 0 0;
		font-family: var(--mono);
		font-size: 7px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.panel-spec b {
		font-family: var(--mono);
		font-size: 10px;
		font-weight: 400;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	.upload {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 10px 11px;
		border: 1px solid var(--ink);
		background: transparent;
		color: var(--ink);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.025em;
		text-transform: uppercase;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.upload:hover {
		background: var(--ink);
		color: var(--paper);
	}
	.upload-plus {
		font-family: var(--sans);
		font-size: 16px;
		line-height: 1;
	}

	.preview {
		margin-top: 10px;
		border: 1px solid var(--ink);
		background: var(--stage);
	}
	.preview img {
		display: block;
		width: 100%;
		max-height: 180px;
		object-fit: cover;
		filter: saturate(0.92) contrast(1.03);
	}
	.preview-meta {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 8px;
		border-top: 1px solid var(--line-strong);
		background: var(--paper);
	}
	.filename {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--mono);
		font-size: 8px;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	.dims {
		flex: 0 0 auto;
		font-family: var(--mono);
		font-size: 8px;
		color: var(--muted);
	}

	.palette {
		display: flex;
		gap: 1px;
		height: 7px;
		margin-top: 10px;
		border: 1px solid var(--ink);
		background: var(--ink);
	}
	.swatch {
		min-width: 3px;
		height: 100%;
	}
	.palette-caption {
		margin: 5px 0 15px;
		font-family: var(--mono);
		font-size: 7px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.grade-block {
		margin-top: 3px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}
	.block-label {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 7px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.block-label span:last-child {
		color: var(--ink);
	}
	.chips {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		border-top: 1px solid var(--line-strong);
		border-left: 1px solid var(--line-strong);
	}
	.chips button {
		padding: 7px 3px;
		border: 0;
		border-right: 1px solid var(--line-strong);
		border-bottom: 1px solid var(--line-strong);
		background: transparent;
		color: var(--ink-soft);
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.chips button:hover {
		background: var(--paper-raised);
	}
	.chips button.active {
		background: var(--ink);
		color: var(--paper);
	}
	.grade-preview {
		height: 9px;
		margin: 9px 0 12px;
		border: 1px solid var(--ink);
	}
	.grade-hint {
		margin: 0 0 11px;
		font-family: var(--mono);
		font-size: 8px;
		line-height: 1.55;
		text-transform: uppercase;
		color: var(--muted);
	}
	.empty-copy {
		margin: 12px 0 0;
		font-family: var(--mono);
		font-size: 8px;
		line-height: 1.6;
		text-transform: uppercase;
		color: var(--muted);
	}

	.presets {
		border-top: 1px solid var(--line-strong);
	}
	.presets button {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) 12px;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 7px;
		border: 0;
		border-bottom: 1px solid var(--line);
		background: transparent;
		color: var(--ink);
		text-align: left;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.presets button:last-child {
		border-bottom-color: var(--line-strong);
	}
	.presets button:hover {
		background: var(--paper-raised);
	}
	.preset-index {
		font-family: var(--mono);
		font-size: 8px;
		color: var(--muted);
	}
	.preset-name {
		font-family: var(--sans);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.015em;
		text-transform: uppercase;
	}
	.preset-mark {
		justify-self: end;
		font-family: var(--mono);
		font-size: 9px;
		color: var(--muted);
	}
	.presets button.active {
		background: var(--ink);
		color: var(--paper);
	}
	.presets button.active .preset-index,
	.presets button.active .preset-mark {
		color: var(--paper);
		opacity: 0.6;
	}
	.preset-note {
		min-height: 34px;
		margin: 9px 0 12px;
		font-family: var(--mono);
		font-size: 8px;
		line-height: 1.55;
		text-transform: uppercase;
		color: var(--muted);
	}

	.transport {
		display: grid;
		grid-template-columns: 1fr 1fr;
		margin-bottom: 7px;
		border: 1px solid var(--ink);
	}
	.transport button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 8px 8px;
		border: 0;
		background: transparent;
		color: var(--ink);
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.transport button + button {
		border-left: 1px solid var(--ink);
	}
	.transport button:hover:not(:disabled) {
		background: var(--ink);
		color: var(--paper);
	}
	.transport button:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	kbd {
		padding: 1px 3px;
		border: 1px solid currentColor;
		border-radius: 0;
		font-family: var(--mono);
		font-size: 7px;
		line-height: 1.2;
		opacity: 0.75;
	}

	.seed-row {
		display: flex;
		margin-bottom: 7px;
		border: 1px solid var(--ink);
	}
	.seed {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 6px 8px;
	}
	.seed span {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.seed input {
		width: 100%;
		min-width: 0;
		padding: 0;
		border: 0;
		outline: 0;
		background: transparent;
		font-family: var(--mono);
		font-size: 10px;
		color: var(--ink);
	}
	.seed input::-webkit-inner-spin-button,
	.seed input::-webkit-outer-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	.dice {
		width: 32px;
		border: 0;
		border-left: 1px solid var(--ink);
		background: transparent;
		color: var(--ink);
		font-family: var(--mono);
		font-size: 13px;
		line-height: 1;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.dice:hover {
		background: var(--ink);
		color: var(--paper);
	}
	.ghost {
		width: 100%;
		padding: 8px;
		border: 1px solid var(--ink);
		background: transparent;
		color: var(--ink);
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.ghost:hover {
		background: var(--ink);
		color: var(--paper);
	}

	.lfo-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}
	.lfo-head > span {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.mini-button {
		padding: 5px 7px;
		border: 1px solid var(--ink);
		background: transparent;
		color: var(--ink);
		font-family: var(--mono);
		font-size: 7px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.mini-button:hover {
		background: var(--ink);
		color: var(--paper);
	}
	.lfo {
		padding: 9px 0 3px;
		border-top: 1px solid var(--line);
	}
	.lfo.off {
		opacity: 0.45;
	}
	.lfo-row {
		display: grid;
		grid-template-columns: 30px minmax(0, 1fr) 58px 22px 26px;
		align-items: center;
		gap: 4px;
	}
	.lfo-name {
		font-family: var(--mono);
		font-size: 7px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.lfo select {
		width: 100%;
		min-width: 0;
		height: 23px;
		padding: 0 2px;
		border: 1px solid var(--line-strong);
		border-radius: 0;
		background: transparent;
		color: var(--ink);
		font-family: var(--mono);
		font-size: 8px;
		text-transform: uppercase;
	}
	.lfo select:focus-visible {
		outline: 1px solid var(--ink);
		outline-offset: 0;
	}
	.lfo-trigger,
	.lfo-power {
		height: 23px;
		padding: 0;
		border: 1px solid var(--line-strong);
		background: transparent;
		color: var(--ink);
		font-family: var(--mono);
		line-height: 1;
		transition:
			background 120ms ease,
			color 120ms ease,
			border-color 120ms ease;
	}
	.lfo-trigger {
		font-size: 11px;
	}
	.lfo-power {
		font-size: 7px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.lfo-trigger:hover {
		border-color: var(--ink);
	}
	.lfo-power.active {
		border-color: var(--ink);
		background: var(--ink);
		color: var(--paper);
	}
	.lfo-sliders {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-top: 6px;
	}
	.mini-slider {
		display: block;
		margin: 0 0 4px;
	}
	.mini-slider > span {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		font-family: var(--mono);
		font-size: 7px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.mini-slider b {
		font-weight: 400;
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
	}
	.mini-slider input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		display: block;
		width: 100%;
		height: 12px;
		margin: 2px 0 0;
		background: transparent;
		cursor: ew-resize;
	}
	.mini-slider input[type='range']::-webkit-slider-runnable-track {
		height: 1px;
		background: var(--line-strong);
	}
	.mini-slider input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 6px;
		height: 6px;
		margin-top: -2.5px;
		border: 0;
		border-radius: 0;
		background: var(--ink);
	}
	.mini-slider input[type='range']::-moz-range-track {
		height: 1px;
		background: var(--line-strong);
	}
	.mini-slider input[type='range']::-moz-range-thumb {
		width: 6px;
		height: 6px;
		border: 0;
		border-radius: 0;
		background: var(--ink);
	}
	.lfo-hint {
		margin: 3px 0 2px;
		font-family: var(--mono);
		font-size: 8px;
		line-height: 1.55;
		text-transform: uppercase;
		color: var(--muted);
	}
	.lfo-hint code {
		font-family: var(--mono);
		font-size: 8px;
		color: var(--ink-soft);
		text-transform: none;
	}

	.panel-footer {
		margin-top: 18px;
		padding-top: 10px;
		border-top: 1px solid var(--ink);
	}
	.panel-footer p {
		margin: 0 0 4px;
		font-family: var(--mono);
		font-size: 7px;
		line-height: 1.5;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.stage {
		position: relative;
		min-width: 0;
		overflow: hidden;
		background: var(--stage);
		color: var(--stage-ink);
	}
	.stage canvas {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
		cursor: crosshair;
	}

	.ticks {
		position: absolute;
		inset: 10px;
		z-index: 3;
		pointer-events: none;
	}
	.ticks i {
		position: absolute;
		width: 10px;
		height: 10px;
		border: 0 solid rgba(242, 240, 234, 0.34);
	}
	.ticks i:nth-child(1) {
		top: 0;
		left: 0;
		border-top-width: 1px;
		border-left-width: 1px;
	}
	.ticks i:nth-child(2) {
		top: 0;
		right: 0;
		border-top-width: 1px;
		border-right-width: 1px;
	}
	.ticks i:nth-child(3) {
		bottom: 0;
		left: 0;
		border-bottom-width: 1px;
		border-left-width: 1px;
	}
	.ticks i:nth-child(4) {
		right: 0;
		bottom: 0;
		border-right-width: 1px;
		border-bottom-width: 1px;
	}

	.stage-line {
		position: absolute;
		left: 26px;
		right: 26px;
		z-index: 4;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		font-family: var(--mono);
		font-size: 8px;
		line-height: 1.3;
		letter-spacing: 0.035em;
		text-transform: uppercase;
		color: var(--stage-muted);
		pointer-events: none;
	}
	.stage-line span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.stage-line span:first-child {
		color: var(--stage-ink);
	}
	.stage-line-top {
		top: 20px;
	}
	.stage-line-bottom {
		bottom: 20px;
	}
	.hud {
		display: flex;
		gap: 7px;
		font-variant-numeric: tabular-nums;
		color: var(--stage-muted);
	}

	.stage.dragging::after {
		content: 'Release to sample';
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 6;
		padding: 8px 11px;
		border: 1px solid var(--ink);
		background: var(--paper);
		color: var(--ink);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.drop {
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: 22px;
		width: min(370px, calc(100% - 48px));
		padding: 15px;
		border: 1px solid var(--ink);
		background: var(--paper);
		color: var(--ink);
		text-align: left;
		transform: translate(-50%, -50%);
		transition:
			background 140ms ease,
			color 140ms ease,
			border-color 140ms ease;
	}
	.drop:hover {
		border-color: var(--stage-ink);
		background: var(--stage);
		color: var(--stage-ink);
	}
	.drop-top {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.drop-top span:last-child {
		font-family: var(--sans);
		font-size: 16px;
		line-height: 0.8;
	}
	.drop-title {
		font-family: var(--sans);
		font-size: clamp(36px, 4.2vw, 54px);
		font-weight: 500;
		line-height: 0.84;
		letter-spacing: -0.06em;
		text-transform: uppercase;
	}
	.drop-sub {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}

	.loading {
		position: absolute;
		inset: 0;
		z-index: 6;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		background: rgba(5, 5, 5, 0.78);
		color: var(--stage-ink);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.loading-line {
		width: 140px;
		height: 1px;
		background: var(--stage-ink);
		animation: sweep 1.1s ease-in-out infinite;
	}
	@keyframes sweep {
		0%,
		100% {
			opacity: 0.25;
			transform: scaleX(0.35);
		}
		50% {
			opacity: 1;
			transform: scaleX(1);
		}
	}

	.error {
		position: absolute;
		right: 19px;
		bottom: 44px;
		left: 19px;
		z-index: 7;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 10px 11px;
		border: 1px solid var(--stage-ink);
		background: var(--paper);
		color: var(--ink);
		font-family: var(--mono);
		font-size: 8px;
		line-height: 1.5;
		text-transform: uppercase;
	}
	.error b {
		font-weight: 500;
	}
	.error button {
		border: 0;
		background: transparent;
		color: var(--ink);
		font-size: 16px;
		line-height: 0.8;
	}

	@media (max-width: 1180px) {
		.mast-meta {
			display: none;
		}
	}

	@media (max-width: 900px) {
		.frame {
			height: auto;
			min-height: calc(100dvh - 16px);
			margin: 8px;
		}
		.masthead {
			flex-wrap: wrap;
			min-height: 48px;
		}
		.brand {
			padding: 0 12px;
			min-height: 48px;
		}
		.brand-name {
			font-size: 20px;
		}
		.brand-sub {
			display: none;
		}
		.mast-stats {
			margin-left: auto;
		}
		.mast-stats span {
			padding: 0 9px;
			font-size: 7px;
		}
		.look button {
			padding: 0 8px;
			font-size: 7px;
		}
		.app {
			display: flex;
			flex-direction: column;
			overflow: visible;
		}
		.stage {
			order: 1;
			height: 58dvh;
			min-height: 330px;
			max-height: 620px;
			border-bottom: 1px solid var(--ink);
		}
		.panel {
			order: 2;
			height: auto;
			overflow: visible;
			padding: 0 14px 26px;
			border-right: 0;
		}
		.panel-head {
			padding-top: 16px;
		}
		.panel-title {
			font-size: 34px;
		}
		.panel-eyebrow {
			margin-bottom: 22px;
		}
		.presets button {
			padding: 8px 7px;
		}
		.stage-line {
			left: 22px;
			right: 22px;
			font-size: 7px;
		}
		.drop {
			width: calc(100% - 36px);
			padding: 13px;
			gap: 18px;
		}
		.drop-title {
			font-size: clamp(34px, 9vw, 52px);
		}
	}

	@media (max-width: 560px) {
		.mast-stats span:nth-child(2) {
			display: none;
		}
		.panel-title {
			font-size: 31px;
		}
		.stage-line-bottom span:last-child {
			display: none;
		}
		.ticks {
			inset: 8px;
		}
		.stage-line-top {
			top: 15px;
		}
		.stage-line-bottom {
			bottom: 15px;
		}
	}

	@media (max-width: 430px) {
		.mast-stats span:nth-child(3) {
			display: none;
		}
		.look button {
			padding: 0 7px;
		}
		.brand {
			padding: 0 10px;
		}
	}
</style>
