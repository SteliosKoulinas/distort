<script lang="ts">
	import { onMount, tick } from 'svelte';
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
		EXPORT_FORMATS,
		estimateBytes,
		findFormat,
		formatBytes,
		formatMbps,
		type ExportFormatId
	} from '#lib/export/formats';
	import { takeSeconds } from '#lib/export/duration';
	import { FrameRecorder } from '#lib/export/recorder';
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
	import LfoScope from '#lib/ui/LfoScope.svelte';
	import AudioScope from '#lib/ui/AudioScope.svelte';
	import { AudioEngine } from '#lib/audio/engine';

	let canvasEl: HTMLCanvasElement;
	let stageEl: HTMLElement;
	let fileEl: HTMLInputElement;
	let audioEl: HTMLInputElement;
	let field: ParticleField | null = null;

	// Stable objects shared with the canvas scopes. They poll these from their
	// own animation frames, so the references must not be reactive.
	const scopeSource: { field: ParticleField | null } = { field: null };
	let audioEngine: AudioEngine | null = null;
	const audioSource: { engine: AudioEngine | null } = { engine: null };

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

	let audioName = $state('');
	let audioDuration = $state(0);
	let audioTime = $state(0);
	let audioLoaded = $state(false);
	let audioLoading = $state(false);
	let audioPlaying = $state(false);
	let audioLive = $state(false);
	let audioLiveName = $state('');

	// Delivery. `stage` means "fill the panel and do not record"; a format
	// both frames the stage and becomes the export size.
	let frame = $state<'stage' | ExportFormatId>('stage');
	// Fixed 60s by default. "Track" deliberately uses the file's own length.
	let exportSeconds = $state(60);
	let customSeconds = $state(90);
	let recording = $state(false);
	let recordStarting = $state(false);
	let recordFinalizing = $state(false);
	let exportBusy = $derived(recording || recordStarting || recordFinalizing);
	let recordElapsed = $state(0);
	let recordTotal = $state(0);
	let recordDetail = $state('');
	let exportError = $state('');
	let exportResult = $state<{
		url: string;
		name: string;
		size: number;
		width: number;
		height: number;
		duration: number;
		encoder: string;
		detail: string;
		hasAudio: boolean;
	} | null>(null);

	let recorder: FrameRecorder | null = null;
	let recordTimer = 0;
	let recordStart = 0;
	let exportUrl = '';
	let recordGeneration = 0;
	let mounted = false;
	let recordPlaybackAbort: AbortController | null = null;

	let activeFormat = $derived(frame === 'stage' ? null : findFormat(frame));
	let recordProgress = $derived(recordTotal > 0 ? Math.min(1, recordElapsed / recordTotal) : 0);
	let deliverSeconds = $derived(
		takeSeconds(exportSeconds, customSeconds, audioDuration, audioLoaded && !audioLive)
	);

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

	function fmtTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
		const whole = Math.floor(seconds);
		return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
	}

	function isAudioFile(file: File): boolean {
		return (
			file.type.startsWith('audio/') ||
			/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i.test(file.name)
		);
	}

	/**
	 * The engine owns the plain routing object. Copying the reactive UI state
	 * into it keeps per-frame frames free of Svelte reads.
	 */
	function applyAudioRouting() {
		if (!audioEngine) return;
		const audio = params.audio;
		audioEngine.routing.amount = audio.reactive ? audio.amount : 0;
		audioEngine.routing.bass = audio.bass;
		audioEngine.routing.mid = audio.mid;
		audioEngine.routing.treble = audio.treble;
	}

	let hudCount = $derived(
		stats
			? `${fmtCount(stats.count)} dots`
			: analysis
				? `${fmtCount(params.particleCount)} dots`
				: 'awaiting image'
	);

	onMount(() => {
		mounted = true;
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
					if (recorder) void stopRecording(false);
				}
			});
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'WebGL is not available in this browser.';
			return () => window.clearInterval(clockTimer);
		}

		field = instance;
		scopeSource.field = instance;
		instance.setParams($state.snapshot(params));

		// Audio is created after the field so its metering clock can hand
		// plain spectral frames straight to the simulation.
		const engine = new AudioEngine();
		engine.setFrameSink((frame) => instance.setAudio(frame));
		engine.onTime = (time, duration) => {
			audioTime = time;
			audioDuration = duration;
		};
		engine.onEnded = () => {
			if (recording && !engine.isLive && recordElapsed < recordTotal - 0.4) {
				engine.seek(0);
				void engine.play().catch((error) => {
					exportError = error instanceof Error ? error.message : 'Audio could not loop.';
					void stopRecording(false);
				});
				return;
			}
			audioPlaying = false;
			audioTime = audioDuration;
		};
		engine.onStreamEnded = () => {
			audioLive = false;
			audioLiveName = '';
		};
		audioEngine = engine;
		audioSource.engine = engine;
		applyAudioRouting();

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
		const onVisibilityChange = () => {
			if (document.hidden && (recording || recordStarting)) {
				exportError = 'Recording interrupted: keep this tab visible during a take.';
				void stopRecording(false);
			}
		};
		document.addEventListener('visibilitychange', onVisibilityChange);

		// Browser-only cleanup, returned from onMount. No onDestroy.
		return () => {
			mounted = false;
			recordGeneration++;
			recordPlaybackAbort?.abort();
			instance.setFrameHook(null);
			recorder?.abort();
			recorder = null;
			window.clearInterval(clockTimer);
			window.clearInterval(recordTimer);
			window.removeEventListener('keydown', onKeyDown);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			scopeSource.field = null;
			audioSource.engine = null;
			audioEngine?.dispose();
			audioEngine = null;
			instance.dispose();
			field = null;
			if (thumbUrl) URL.revokeObjectURL(thumbUrl);
			if (exportUrl) URL.revokeObjectURL(exportUrl);
		};
	});

	// Delivery preview uses the same framebuffer as recording, including grain.
	$effect(() => {
		const format = activeFormat;
		if (format) field?.setExportSize(format.width, format.height);
		else field?.clearExportSize();
	});

	// The UI writes a plain snapshot on a control change. The animation loop
	// never reads Svelte state; it receives this ordinary object.
	$effect(() => {
		const snapshot = $state.snapshot(params);
		if (field) field.setParams(snapshot);
	});

	// Same idea for audio: the reactive controls are copied into the engine's
	// plain routing object, which its metering clock reads per frame.
	$effect(() => {
		const audio = params.audio;
		const routing = {
			amount: audio.reactive ? audio.amount : 0,
			bass: audio.bass,
			mid: audio.mid,
			treble: audio.treble
		};
		const engine = audioEngine;
		if (!engine) return;
		engine.routing.amount = routing.amount;
		engine.routing.bass = routing.bass;
		engine.routing.mid = routing.mid;
		engine.routing.treble = routing.treble;
	});

	async function loadFile(file: File) {
		if (exportBusy) return;
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

	async function loadAudioFile(file: File) {
		if (exportBusy) return;
		errorMessage = '';

		if (!isAudioFile(file)) {
			errorMessage = 'That file is not audio. Try MP3, M4A, WAV or OGG.';
			return;
		}
		const engine = audioEngine;
		if (!engine) {
			errorMessage = 'The audio engine is not ready yet. Try again in a moment.';
			return;
		}

		stopLive();
		audioLoading = true;
		try {
			const track = await engine.load(file);
			audioName = track.name;
			audioDuration = track.duration;
			audioTime = 0;
			audioLoaded = true;
			audioPlaying = false;
		} catch (error) {
			audioName = '';
			audioDuration = 0;
			audioTime = 0;
			audioLoaded = false;
			audioPlaying = false;
			errorMessage = error instanceof Error ? error.message : 'Could not read that audio.';
		} finally {
			audioLoading = false;
		}
	}

	function onAudioChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) void loadAudioFile(file);
	}

	async function toggleAudio() {
		if (exportBusy) return;
		const engine = audioEngine;
		if (!engine || !audioLoaded || audioLoading || audioLive) return;

		errorMessage = '';
		if (engine.isPlaying) {
			engine.pause();
			audioPlaying = false;
			audioTime = engine.currentTime;
			return;
		}

		try {
			await engine.play();
			audioPlaying = true;
		} catch {
			audioPlaying = false;
			errorMessage = 'Playback could not start. Click Play again.';
		}
	}

	function seekAudio(event: Event) {
		if (exportBusy) return;
		const input = event.currentTarget as HTMLInputElement;
		const next = Number(input.value);
		if (!Number.isFinite(next)) return;
		audioEngine?.seek(next);
		audioTime = next;
	}

	/**
	 * Analyse whatever the machine is playing — Spotify, a DAW, a browser tab.
	 * The captured audio is never replayed; it only feeds the spectrum.
	 */
	async function startSystemAudio() {
		if (exportBusy) return;
		errorMessage = '';
		const engine = audioEngine;
		if (!engine) return;

		const media = navigator.mediaDevices as MediaDevices | undefined;
		if (!media?.getDisplayMedia) {
			errorMessage = 'This browser cannot capture system audio. Try Chrome on desktop.';
			return;
		}

		try {
			// A video track is usually required to obtain an audio track from a
			// display capture; it is ignored here.
			const stream = await media.getDisplayMedia({ video: true, audio: true });
			if (stream.getAudioTracks().length === 0) {
				for (const track of stream.getTracks()) track.stop();
				errorMessage =
					'No audio was shared. Pick a screen or window and tick “Share system audio”.';
				return;
			}
			engine.attachStream(stream, 'System audio');
			audioLive = true;
			audioLiveName = 'System audio';
			audioPlaying = false;
		} catch {
			// The user cancelled the picker, or the browser denied capture.
		}
	}

	async function startMicrophone() {
		if (exportBusy) return;
		errorMessage = '';
		const engine = audioEngine;
		if (!engine) return;

		const media = navigator.mediaDevices as MediaDevices | undefined;
		if (!media?.getUserMedia) {
			errorMessage = 'This browser cannot reach a microphone.';
			return;
		}

		try {
			const stream = await media.getUserMedia({ audio: true });
			engine.attachStream(stream, 'Microphone');
			audioLive = true;
			audioLiveName = 'Microphone';
			audioPlaying = false;
		} catch {
			errorMessage = 'Microphone access was blocked.';
		}
	}

	function stopLive() {
		if (exportBusy) return;
		if (!audioLive && !audioEngine?.isLive) {
			audioLive = false;
			return;
		}
		audioEngine?.detachStream();
		audioLive = false;
		audioLiveName = '';
		audioPlaying = false;
	}

	function resampleNow() {
		if (!field) return;
		field.setParams($state.snapshot(params));
		field.resample();
	}

	function chooseFrame(next: 'stage' | ExportFormatId) {
		if (exportBusy) return;
		frame = next;
	}

	function releaseExport() {
		if (exportUrl) URL.revokeObjectURL(exportUrl);
		exportUrl = '';
		exportResult = null;
	}

	/**
	 * Record the canvas at delivery resolution.
	 *
	 * The stage is framed to the target aspect first, then the renderer is
	 * asked for the exact delivery size, so what is recorded is the same
	 * composition that was on screen — at 1080 px wide. Audio starts from the
	 * top of the take, because the piece is built around the sound opening it.
	 */
	async function startRecording() {
		if (exportBusy || loading || audioLoading) return;
		exportError = '';
		const instance = field;
		if (!instance || !analysis) {
			exportError = 'Load an image before recording.';
			return;
		}

		const format = activeFormat ?? EXPORT_FORMATS[0];
		if (frame === 'stage') frame = format.id;

		const engine = audioEngine;
		const seconds = deliverSeconds;
		const generation = ++recordGeneration;

		releaseExport();
		recordStarting = true;
		recordElapsed = 0;
		recordTotal = seconds;
		recordDetail = '';
		if (engine && !engine.isLive) {
			engine.pause();
			engine.seek(0);
			audioPlaying = false;
			// Request audio activation before the first await loses the
			// transient click gesture (important on autoplay-restricted hosts).
			engine.activate();
		}

		// Let the new stage framing settle before the renderer is resized.
		await tick();
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		if (!mounted || generation !== recordGeneration) return;

		instance.setExportSize(format.width, format.height);

		let created: FrameRecorder;
		try {
			created = await FrameRecorder.create({
				canvas: canvasEl,
				audioStream: engine?.getRecordStream() ?? null,
				width: format.width,
				height: format.height,
				fps: format.fps,
				bitrate: format.bitrate,
				sampleRate: engine?.sampleRate ?? 48_000,
				duration: seconds
			});
		} catch (error) {
			if (!mounted || generation !== recordGeneration) return;
			recordStarting = false;
			exportError = error instanceof Error ? error.message : 'Recording could not start.';
			return;
		}
		if (!mounted || generation !== recordGeneration) {
			created.abort();
			return;
		}

		recorder = created;
		recordDetail = created.detail;
		instance.setFrameHook((canvas) => {
			try {
				created.pushFrame(canvas);
			} catch (error) {
				exportError = error instanceof Error ? error.message : 'Recording failed.';
				void stopRecording(false);
			}
		});

		// Start from the image, not mid-drift, and let the sound open it.
		instance.reassemble();
		if (engine && audioLoaded && !audioLive) {
			engine.seek(0);
			const controller = new AbortController();
			recordPlaybackAbort = controller;
			const playbackAborted = new Promise<never>((_, reject) => {
				controller.signal.addEventListener(
					'abort',
					() => reject(new Error('Audio playback could not start. Try again after pressing Play.')),
					{ once: true }
				);
			});
			const timeout = window.setTimeout(() => controller.abort(), 5_000);
			try {
				await Promise.race([engine.play(controller.signal), playbackAborted]);
				audioPlaying = true;
			} catch (error) {
				audioPlaying = false;
				exportError = error instanceof Error ? error.message : 'Audio playback could not start.';
				await stopRecording(false);
				return;
			} finally {
				window.clearTimeout(timeout);
				if (recordPlaybackAbort === controller) recordPlaybackAbort = null;
			}
		}
		if (!mounted || generation !== recordGeneration) return;

		recordStarting = false;
		recording = true;
		recordStart = performance.now();
		recordTimer = window.setInterval(() => {
			const elapsed = (performance.now() - recordStart) / 1000;
			recordElapsed = Math.min(seconds, elapsed);
			if (elapsed >= seconds) void stopRecording(true);
		}, 100);
	}

	async function stopRecording(keep: boolean) {
		if (recordFinalizing || (!recordStarting && !recording && !recorder)) return;
		const generation = ++recordGeneration;
		recordPlaybackAbort?.abort();
		recordPlaybackAbort = null;
		const format = activeFormat ?? EXPORT_FORMATS[0];
		if (recordTimer) window.clearInterval(recordTimer);
		recordTimer = 0;

		const instance = field;
		instance?.setFrameHook(null);
		const active = recorder;
		recording = false;
		recordStarting = false;
		if (!audioEngine?.isLive) {
			audioPlaying = false;
			audioEngine?.pause();
		}
		if (!active) return;
		if (!keep) {
			active.abort();
			recorder = null;
			return;
		}

		recordFinalizing = true;
		try {
			const result = await active.stop();
			if (!mounted || generation !== recordGeneration) return;
			const name = `distort-${format.id}-${result.width}x${result.height}.${result.extension}`;
			releaseExport();
			exportUrl = URL.createObjectURL(result.blob);
			exportResult = {
				url: exportUrl,
				name,
				size: result.blob.size,
				width: result.width,
				height: result.height,
				duration: result.duration,
				encoder: result.encoder,
				detail: result.detail,
				hasAudio: result.hasAudio
			};

			// Hand the file straight to the browser; a take that only lives in
			// an object URL is easy to lose.
			const anchor = document.createElement('a');
			anchor.href = exportUrl;
			anchor.download = name;
			anchor.click();
		} catch (error) {
			if (mounted && generation === recordGeneration) {
				exportError = error instanceof Error ? error.message : 'The take could not be finished.';
			}
		} finally {
			if (recorder === active) recorder = null;
			if (mounted) recordFinalizing = false;
		}
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
		if (!file) return;
		if (isAudioFile(file)) void loadAudioFile(file);
		else void loadFile(file);
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

<input
	bind:this={audioEl}
	class="hidden-input"
	type="file"
	accept="audio/*"
	onchange={onAudioChange}
	aria-label="Choose audio"
/>

<div class="frame">
	<header class="masthead">
		<div class="brand">
			<a class="brand-name" href="/">Distort</a>
			<span class="brand-sub">A portrait in dust</span>
		</div>
		<div class="mast-meta" aria-hidden="true">
			<span>Image → particle field</span>
			<span>Phase 02 / 02</span>
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
					The full photograph stays visible beneath <strong>{fmtCount(params.particleCount)}</strong>
					points. Sound refracts the image; move the pointer to pull its grain apart.
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
						Drop a photograph into the stage. Its pixels stay whole while a second, fine-grained
						particle field is sampled from it.
					</p>
				{/if}
			</Section>

			<Section title="Image / optics" kicker="02" open={true}>
				<Toggle
					label="Continuous image"
					bind:checked={params.photo.enabled}
					hint="The complete photograph sits beneath the particle field. Turn off for the original dot-only look."
				/>
				{#if params.photo.enabled}
					<Slider
						label="Particles"
						bind:value={params.photo.particles}
						min={0} max={1} step={0.01} format={fmt2}
						hint="0 = photograph alone, 1 = dots alone. Default keeps every part of the source readable."
					/>
					<Slider
						label="Break"
						bind:value={params.photo.amount}
						min={0} max={1} step={0.01} format={fmt2}
						hint="Master optical destruction. At 0 the photograph is intact; at 1 the effects can tear it beyond recognition."
					/>
					<Slider
						label="Refraction"
						bind:value={params.photo.refraction}
						min={0} max={1} step={0.01} format={fmt2}
						hint="Liquid glass follows the actual image contours. Bass moves the lens."
					/>
					<Slider
						label="Folds"
						bind:value={params.photo.folds}
						min={0} max={1} step={0.01} format={fmt2}
						hint="The photograph bends into displaced strips; beats pull them sideways."
					/>
					<Slider
						label="Blocks"
						bind:value={params.photo.blocks}
						min={0} max={1} step={0.01} format={fmt2}
						hint="Stable fragments and pixelation; treble opens the gaps. At max the image can disintegrate."
					/>
					<Slider
						label="Chromatic split"
						bind:value={params.photo.chroma}
						min={0} max={1} step={0.01} format={fmt2}
						hint="RGB channels part along the contours, without removing the underlying pixels."
					/>
					<p class="grade-hint">All optics are audio-led. Without sound the complete source stays legible. Push Break and the effects to 1 with Motion at 1 for full deconstruction.</p>
				{/if}
			</Section>

			<Section title="Form" kicker="03" open={true}>
				<Toggle
					label="Image surface"
					bind:checked={params.form.enabled}
					hint="Refraction, cells, slices and relief are read from the photograph itself."
				/>

				{#if params.form.enabled}
					<Slider
						label="Lens"
						bind:value={params.form.lens}
						min={0}
						max={1}
						step={0.01}
						format={fmt2}
						hint="Bends contours along their own gradient. Bass opens it first, so edges shimmer before anything moves."
					/>
					<Slider
						label="Raster"
						bind:value={params.form.raster}
						min={0}
						max={1}
						step={0.01}
						format={fmt2}
						hint="Cuts the image into its own cells and lets each pane drift. Treble opens it."
					/>
					<Slider
						label="Slices"
						bind:value={params.form.slice}
						min={0}
						max={1}
						step={0.01}
						format={fmt2}
						hint="Lifts horizontal bands sideways, keeping their colour. Beats open it."
					/>
					<Slider
						label="Relief"
						bind:value={params.form.relief}
						min={0}
						max={1}
						step={0.01}
						format={fmt2}
						hint="Raises bright structure toward the viewer. Loudness opens it."
					/>
					<p class="grade-hint">
						All four share the Motion gate. Silent, the photograph is simply itself; the sound decides
						how far the surface opens.
					</p>
				{/if}
			</Section>

			<Section title="Audio" kicker="04" open={true}>
				<button class="upload" onclick={() => audioEl.click()} type="button">
					<span>{audioLoaded ? 'Replace audio' : 'Choose audio'}</span>
					<span class="upload-plus" aria-hidden="true">{audioLoaded ? '↺' : '+'}</span>
				</button>

				<div class="audio-source" role="group" aria-label="Live input">
					<button
						type="button"
						class:active={audioLive && audioLiveName === 'System audio'}
						aria-pressed={audioLive && audioLiveName === 'System audio'}
						onclick={startSystemAudio}
					>
						System audio
					</button>
					<button
						type="button"
						class:active={audioLive && audioLiveName === 'Microphone'}
						aria-pressed={audioLive && audioLiveName === 'Microphone'}
						onclick={startMicrophone}
					>
						Microphone
					</button>
				</div>
				<p class="audio-hint">
					System audio follows whatever the machine plays — Spotify, a DAW, another tab. It is
					analysed only and never replayed through the speakers.
				</p>

				{#if audioLive}
					<div class="audio-meta">
						<span class="filename">{audioLiveName}</span>
						<span class="dims">live</span>
					</div>
					<div class="audio-transport">
						<button type="button" onclick={stopLive} aria-label="Stop live input">
							<span>Stop</span>
							<span aria-hidden="true">■</span>
						</button>
						<span class="audio-time">listening</span>
					</div>
				{:else if audioLoaded}
					<div class="audio-meta">
						<span class="filename" title={audioName}>{audioName}</span>
						<span class="dims">{fmtTime(audioDuration)}</span>
					</div>

					<div class="audio-transport">
						<button
							type="button"
							onclick={toggleAudio}
							aria-label={audioPlaying ? 'Pause audio' : 'Play audio'}
						>
							<span>{audioPlaying ? 'Pause' : 'Play'}</span>
							<span aria-hidden="true">{audioPlaying ? '❚❚' : '▶'}</span>
						</button>
						<span class="audio-time">{fmtTime(audioTime)} / {fmtTime(audioDuration)}</span>
					</div>

					<label class="audio-seek">
						<input
							type="range"
							min="0"
							max={Math.max(0.01, audioDuration)}
							step="0.01"
							value={audioTime}
							oninput={seekAudio}
							aria-label="Seek audio"
						/>
					</label>
				{:else}
					<p class="empty-copy">
						The image stands still until sound arrives. Add a track, capture system audio, or open
						the microphone — the spectrum opens the motion.
					</p>
				{/if}

				{#if audioLoading}<p class="audio-loading">Reading audio…</p>{/if}

				<AudioScope source={audioSource} />

				<div class="audio-axis" aria-hidden="true">
					<span>Bass · 20–160</span>
					<span>Mid · 160–2k</span>
					<span>Treble · 2k–12k</span>
				</div>

				<Toggle
					label="Audio reactive"
					bind:checked={params.audio.reactive}
					hint="When off, the image stays still."
				/>
				<Slider
					label="Motion"
					bind:value={params.audio.motion}
					min={0}
					max={1}
					step={0.01}
					format={fmt2}
					hint="How far the image opens while audio plays. At 0 it stays near the source."
				/>
				<Slider
					label="Spectrum"
					bind:value={params.audio.amount}
					min={0}
					max={2}
					step={0.01}
					format={fmt2}
					hint="Depth of the spectral band forces on top of the motion."
				/>

				<div class="audio-toggle" role="group" aria-label="Spectral bands">
					<button
						type="button"
						class:active={params.audio.bass}
						aria-pressed={params.audio.bass}
						onclick={() => (params.audio.bass = !params.audio.bass)}
					>
						Bass
					</button>
					<button
						type="button"
						class:active={params.audio.mid}
						aria-pressed={params.audio.mid}
						onclick={() => (params.audio.mid = !params.audio.mid)}
					>
						Mid
					</button>
					<button
						type="button"
						class:active={params.audio.treble}
						aria-pressed={params.audio.treble}
						onclick={() => (params.audio.treble = !params.audio.treble)}
					>
						Treble
					</button>
				</div>
			</Section>

			<Section title="Export" kicker="05" open={true}>
				<div class="block-label">
					<span>Frame</span>
					<span>{activeFormat ? activeFormat.note : 'as shown'}</span>
				</div>
				<div class="chips export-chips frame-chips" role="group" aria-label="Frame and delivery size">
					<button
						type="button"
						class:active={frame === 'stage'}
						aria-pressed={frame === 'stage'}
						disabled={exportBusy}
						onclick={() => chooseFrame('stage')}
					>
						Stage
					</button>
					{#each EXPORT_FORMATS as option (option.id)}
						<button
							type="button"
							class:active={frame === option.id}
							aria-pressed={frame === option.id}
							disabled={exportBusy}
							onclick={() => chooseFrame(option.id)}
						>
							{option.label}
						</button>
					{/each}
				</div>

				{#if activeFormat}
					<div class="export-spec">
						<span><b>{activeFormat.width} × {activeFormat.height}</b></span>
						<span>{activeFormat.fps} fps</span>
						<span>{formatMbps(activeFormat.bitrate)}</span>
						<span>H.264 target</span>
					</div>
					<p class="grade-hint">
						Target size ~{formatBytes(estimateBytes(activeFormat, deliverSeconds))} for a
						{deliverSeconds.toFixed(0)} s take. MP4 / H.264, AAC 192 kbps when audio is selected.
						The browser chooses the supported encoder; actual size varies.
					</p>
				{:else}
					<p class="grade-hint">
						Pick <b>Reel</b> for 9:16 or <b>Post</b> for 4:5. The stage reframes to that aspect, so the
						preview and the file are the same composition.
					</p>
				{/if}

				<div class="block-label"><span>Take</span><span>{deliverSeconds.toFixed(0)} s</span></div>
				<div class="chips export-chips" role="group" aria-label="Take length">
					<button
						type="button"
						class:active={exportSeconds === 0}
						aria-pressed={exportSeconds === 0}
						disabled={exportBusy}
						onclick={() => (exportSeconds = 0)}
					>
						Track
					</button>
					{#each [30, 60, 120, 180] as seconds (seconds)}
						<button
							type="button"
							class:active={exportSeconds === seconds}
							aria-pressed={exportSeconds === seconds}
							disabled={exportBusy}
							onclick={() => (exportSeconds = seconds)}
						>
							{seconds}s
						</button>
					{/each}
				</div>
				<div class="custom-take">
					<label for="custom-take-seconds">Custom seconds (1–300)</label>
					<input
						id="custom-take-seconds"
						type="number"
						min="1"
						max="300"
						step="1"
						bind:value={customSeconds}
						disabled={exportBusy}
						onfocus={() => (exportSeconds = -1)}
						oninput={() => (exportSeconds = -1)}
					/>
				</div>
				<p class="grade-hint">
					Default 60 s. Track uses the file's duration (up to 300 s); without a file it means 60 s.
					Short tracks loop to fill longer takes. Live audio starts from the current moment.
					Long takes stay in browser memory until download; choose a shorter take if memory is limited.
				</p>

				<button
					class="record"
					type="button"
					class:recording
					disabled={recordStarting || recordFinalizing || loading || audioLoading}
					onclick={() => (recording ? stopRecording(true) : startRecording())}
				>
					<span>{recordStarting ? 'Preparing…' : recordFinalizing ? 'Finishing…' : recording ? 'Stop and keep' : 'Record take'}</span>
					<span class="record-dot" aria-hidden="true"></span>
				</button>

				{#if recording}
					<div class="record-progress" aria-hidden="true">
						<span style:width={`${recordProgress * 100}%`}></span>
					</div>
					<p class="grade-hint">
						{recordElapsed.toFixed(1)} / {recordTotal.toFixed(1)} s — encoded while it plays. Leave the
						tab visible.
					</p>
				{/if}

				{#if recordDetail && !recording}
					<p class="grade-hint">{recordDetail}</p>
				{/if}

				{#if exportError}
					<p class="export-error" role="alert">{exportError}</p>
				{/if}

				{#if exportResult}
					<div class="export-out">
						<div class="audio-meta">
							<span class="filename" title={exportResult.name}>{exportResult.name}</span>
							<span class="dims">{formatBytes(exportResult.size)}</span>
						</div>
						<p class="grade-hint">
							{exportResult.width} × {exportResult.height} · {exportResult.duration.toFixed(1)} s ·
							{exportResult.encoder}
						</p>
						<a class="download" href={exportResult.url} download={exportResult.name}>
							<span>Download</span><span aria-hidden="true">↓</span>
						</a>
						<p class="grade-hint">
							{exportResult.hasAudio
								? 'Audio is muxed in.'
								: 'Silent file — add the track in the Instagram editor.'}
							{exportResult.detail}
						</p>
					</div>
				{/if}

				<p class="grade-hint">
					Instagram re-encodes every upload; lossless delivery cannot be guaranteed.
					Upload the exported file directly and enable “Upload at highest quality” in Instagram.
					WebCodecs targets 30 fps; the browser recorder is the fallback.
				</p>
			</Section>

			<Section title="Presets" kicker="06" open={true}>
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

			<Section title="Particles" kicker="07" open={true}>
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

			<Section title="Flow field" kicker="08" open={true}>
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

			<Section title="Return" kicker="09">
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

			<Section title="Pointer" kicker="10">
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

			<Section title="Pulse" kicker="11">
				<Toggle label="Radial pulse" bind:checked={params.pulseEnabled} />
				<Toggle
					label="Auto pulse"
					bind:checked={params.autoPulse}
					hint="A metronome when no audio is playing."
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

			<Section title="Wave" kicker="12">
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

			<Section title="Fracture" kicker="13">
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

			<Section title="Depth" kicker="14">
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

			<Section title="Modulation" kicker="15" open={false}>
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

						<LfoScope
							source={scopeSource}
							index={index}
							shape={lfo.shape}
							rate={lfo.rate}
							depth={lfo.depth}
							enabled={lfo.enabled}
						/>

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

		<div class="stage-slot">
		<main
			bind:this={stageEl}
			class="stage"
			class:dragging={dragActive}
			class:framed={frame !== 'stage'}
			style:aspect-ratio={activeFormat?.aspect}
			style:--frame-aspect={activeFormat ? activeFormat.width / activeFormat.height : 1}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
		>
			<canvas bind:this={canvasEl} aria-label="Audio-reactive photograph and particle field"></canvas>

			<div class="ticks" aria-hidden="true"><i></i><i></i><i></i><i></i></div>

			<div class="stage-line stage-line-top">
				<span>Fig. 01 — Portrait in dust</span>
				<span class="hud" aria-live="off">
					{recording ? 'REC' : `${stats ? stats.fps.toFixed(0) : '—'} fps`} / {hudCount}
				</span>
			</div>

			<div class="stage-line stage-line-bottom">
				<span>{analysis ? 'Move pointer to distort' : 'Input — JPG / PNG / WebP'}</span>
				<span>
					{activeFormat
						? `${activeFormat.width}×${activeFormat.height} · ${activeFormat.fps} fps`
						: stats
							? `${stats.textureSize}² / ${stats.precision}`
							: 'WebGL2 / render-to-float'}
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

	.audio-meta {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-top: 8px;
		padding: 6px 8px;
		border: 1px solid var(--ink);
	}
	.audio-transport {
		display: flex;
		align-items: stretch;
		justify-content: space-between;
		margin-top: 6px;
		border: 1px solid var(--ink);
	}
	.audio-transport button {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
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
	.audio-transport button:hover {
		background: var(--ink);
		color: var(--paper);
	}
	.audio-transport button span:last-child {
		font-size: 9px;
		line-height: 1;
	}
	.audio-time {
		display: flex;
		align-items: center;
		padding: 0 10px;
		border-left: 1px solid var(--ink);
		font-family: var(--mono);
		font-size: 8px;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	.audio-seek {
		display: block;
		margin: 2px 0 0;
	}
	.audio-seek input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		display: block;
		width: 100%;
		height: 16px;
		margin: 0;
		background: transparent;
		cursor: ew-resize;
	}
	.audio-seek input[type='range']::-webkit-slider-runnable-track {
		height: 1px;
		background: var(--line-strong);
	}
	.audio-seek input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 7px;
		height: 7px;
		margin-top: -3px;
		border: 0;
		border-radius: 0;
		background: var(--ink);
	}
	.audio-seek input[type='range']::-moz-range-track {
		height: 1px;
		background: var(--line-strong);
	}
	.audio-seek input[type='range']::-moz-range-thumb {
		width: 7px;
		height: 7px;
		border: 0;
		border-radius: 0;
		background: var(--ink);
	}
	.audio-axis {
		display: grid;
		grid-template-columns: 28% 42% 30%;
		margin: 4px 0 10px;
		font-family: var(--mono);
		font-size: 7px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.audio-axis span:nth-child(2) {
		text-align: center;
	}
	.audio-axis span:last-child {
		text-align: right;
	}
	.audio-toggle {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		border: 1px solid var(--ink);
	}
	.audio-source {
		display: grid;
		grid-template-columns: 1fr 1fr;
		margin-top: 6px;
		border: 1px solid var(--ink);
	}
	.audio-source button {
		padding: 7px 0;
		border: 0;
		background: transparent;
		color: var(--muted);
		font-family: var(--mono);
		font-size: 7px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.audio-source button + button {
		border-left: 1px solid var(--line-strong);
	}
	.audio-source button:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.audio-source button:hover:not(:disabled) {
		color: var(--ink);
	}
	.audio-source button.active {
		background: var(--ink);
		color: var(--paper);
	}
	.audio-hint {
		margin: 6px 0 10px;
		font-family: var(--mono);
		font-size: 7px;
		line-height: 1.6;
		text-transform: uppercase;
		color: var(--muted);
	}

	.chips.export-chips {
		grid-template-columns: repeat(5, minmax(0, 1fr));
		margin-bottom: 8px;
	}
	.chips.frame-chips {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	.custom-take {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin: 6px 0;
		font-family: var(--mono);
		font-size: 8px;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	.custom-take input {
		width: 68px;
		padding: 5px 7px;
		border: 1px solid var(--line-strong);
		border-radius: 0;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
	}
	.export-spec {
		display: flex;
		flex-wrap: wrap;
		gap: 3px 10px;
		margin: 7px 0 5px;
		font-family: var(--mono);
		font-size: 7px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.export-spec b {
		font-weight: 500;
		color: var(--ink);
	}
	.record {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		margin: 10px 0 8px;
		padding: 10px 11px;
		border: 1px solid var(--ink);
		background: var(--ink);
		color: var(--paper);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.record:hover {
		background: var(--paper);
		color: var(--ink);
	}
	.record.recording {
		background: transparent;
		color: var(--ink);
	}
	.record:disabled,
	.export-chips button:disabled {
		cursor: wait;
		opacity: 0.55;
	}
	.record-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #bb4a2f;
	}
	.record.recording .record-dot {
		background: var(--ink);
	}
	.record-progress {
		height: 3px;
		margin: 0 0 6px;
		background: var(--line-strong);
	}
	.record-progress span {
		display: block;
		height: 100%;
		background: var(--ink);
		transition: width 120ms linear;
	}
	.export-out {
		margin: 6px 0 8px;
	}
	.download {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 6px;
		padding: 8px 10px;
		border: 1px solid var(--ink);
		color: var(--ink);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		text-decoration: none;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.download:hover {
		background: var(--ink);
		color: var(--paper);
	}
	.export-error {
		margin: 6px 0 8px;
		padding: 6px 8px;
		border: 1px solid #bb4a2f;
		font-family: var(--mono);
		font-size: 8px;
		line-height: 1.5;
		color: #bb4a2f;
	}
	.audio-toggle {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		border: 1px solid var(--ink);
	}
	.audio-toggle button {
		padding: 6px 0;
		border: 0;
		background: transparent;
		color: var(--muted);
		font-family: var(--mono);
		font-size: 7px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.audio-toggle button + button {
		border-left: 1px solid var(--line-strong);
	}
	.audio-toggle button:hover {
		color: var(--ink);
	}
	.audio-toggle button.active {
		background: var(--ink);
		color: var(--paper);
	}
	.audio-loading {
		margin: 6px 0 0;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
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

	.stage-slot {
		container-type: size;
		display: grid;
		place-items: center;
		min-width: 0;
		min-height: 0;
		background: var(--stage);
	}
	.stage {
		position: relative;
		min-width: 0;
		width: 100%;
		height: 100%;
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
	/* A chosen delivery format reframes the stage, so the preview and the file
	   are the same composition. The renderer is later asked for 1080 px. */
	.stage.framed {
		width: min(100cqw, calc(100cqh * var(--frame-aspect)));
		height: auto;
		outline: 1px solid var(--line-strong);
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
		content: 'Release to load';
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
		.stage-slot {
			order: 1;
			flex: none;
			width: 100%;
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
