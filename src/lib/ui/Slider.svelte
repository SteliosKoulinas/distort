<script lang="ts">
	interface Props {
		label: string;
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		format?: (value: number) => string;
		hint?: string;
		onchange?: () => void;
	}

	let {
		label,
		value = $bindable(0),
		min = 0,
		max = 1,
		step = 0.01,
		format = (v: number) => v.toFixed(2),
		hint,
		onchange
	}: Props = $props();
</script>

<label class="slider">
	<span class="row">
		<span class="name">{label}</span>
		<span class="value">{format(value)}</span>
	</span>
	<input type="range" {min} {max} {step} bind:value onchange={onchange} aria-label={label} />
	{#if hint}<span class="hint">{hint}</span>{/if}
</label>

<style>
	.slider {
		display: block;
		margin: 0 0 12px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 5px;
	}
	.name {
		font-family: var(--sans);
		font-size: 10px;
		line-height: 1.2;
		letter-spacing: 0.015em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	.value {
		font-family: var(--mono);
		font-size: 9px;
		line-height: 1.2;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		display: block;
		width: 100%;
		height: 14px;
		margin: 0;
		background: transparent;
		cursor: ew-resize;
	}
	input[type='range']::-webkit-slider-runnable-track {
		height: 1px;
		background: var(--line-strong);
	}
	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 7px;
		height: 7px;
		margin-top: -3px;
		border: 0;
		border-radius: 0;
		background: var(--ink);
	}
	input[type='range']:hover::-webkit-slider-thumb {
		background: var(--paper);
		box-shadow: 0 0 0 1px var(--ink);
	}
	input[type='range']::-moz-range-track {
		height: 1px;
		background: var(--line-strong);
	}
	input[type='range']::-moz-range-thumb {
		width: 7px;
		height: 7px;
		border: 0;
		border-radius: 0;
		background: var(--ink);
	}
	.hint {
		display: block;
		margin-top: 3px;
		font-family: var(--mono);
		font-size: 8px;
		line-height: 1.5;
		letter-spacing: 0.01em;
		text-transform: uppercase;
		color: var(--muted);
	}
</style>
