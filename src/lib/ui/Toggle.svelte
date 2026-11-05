<script lang="ts">
	interface Props {
		label: string;
		checked?: boolean;
		hint?: string;
		onchange?: () => void;
	}

	let { label, checked = $bindable(false), hint, onchange }: Props = $props();
</script>

<label class="toggle">
	<span class="copy">
		<span class="name">{label}</span>
		{#if hint}<span class="hint">{hint}</span>{/if}
	</span>
	<span class="control">
		<input type="checkbox" bind:checked onchange={onchange} aria-label={label} />
		<span class="track" aria-hidden="true"></span>
	</span>
</label>

<style>
	.toggle {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 14px;
		margin: 0 0 11px;
		cursor: pointer;
	}
	.copy {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.name {
		font-family: var(--sans);
		font-size: 10px;
		line-height: 1.2;
		letter-spacing: 0.015em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	.hint {
		font-family: var(--mono);
		font-size: 8px;
		line-height: 1.5;
		text-transform: uppercase;
		color: var(--muted);
	}
	.control {
		position: relative;
		flex: 0 0 auto;
		width: 11px;
		height: 11px;
		margin-top: 1px;
	}
	input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
		z-index: 2;
	}
	.track {
		position: absolute;
		inset: 0;
		border: 1px solid var(--line-strong);
		background: transparent;
		transition:
			background 120ms ease,
			border-color 120ms ease;
	}
	.track::after {
		content: '';
		position: absolute;
		inset: 2px;
		background: var(--paper);
		opacity: 0;
		transition: opacity 120ms ease;
	}
	input:checked + .track {
		border-color: var(--ink);
		background: var(--ink);
	}
	input:checked + .track::after {
		opacity: 1;
	}
	input:focus-visible + .track {
		outline: 1px solid var(--ink);
		outline-offset: 2px;
	}
</style>
