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
		margin: 0 0 15px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 7px;
	}
	.name {
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--paper-dim);
	}
	.value {
		font-family: var(--mono);
		font-size: 10px;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		display: block;
		width: 100%;
		height: 16px;
		margin: 0;
		background: transparent;
		cursor: ew-resize;
	}
	input[type='range']::-webkit-slider-runnable-track {
		height: 1px;
		background: var(--line-bright);
	}
	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 9px;
		height: 9px;
		margin-top: -4px;
		border-radius: 50%;
		background: var(--paper);
		box-shadow: 0 0 0 3px var(--panel);
		transition: background 120ms ease;
	}
	input[type='range']:hover::-webkit-slider-thumb {
		background: var(--accent);
	}
	input[type='range']::-moz-range-track {
		height: 1px;
		background: var(--line-bright);
	}
	input[type='range']::-moz-range-thumb {
		width: 9px;
		height: 9px;
		border: 0;
		border-radius: 50%;
		background: var(--paper);
	}
	.hint {
		display: block;
		margin-top: 5px;
		font-size: 10px;
		line-height: 1.45;
		color: var(--muted);
	}
</style>
