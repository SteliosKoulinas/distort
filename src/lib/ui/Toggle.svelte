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
		<span class="track" aria-hidden="true"><span class="thumb"></span></span>
	</span>
</label>

<style>
	.toggle {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 14px;
		margin: 0 0 13px;
		cursor: pointer;
	}
	.copy {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.name {
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--paper-dim);
	}
	.hint {
		font-size: 10px;
		line-height: 1.4;
		color: var(--muted);
	}
	.control {
		position: relative;
		flex: 0 0 auto;
		width: 30px;
		height: 16px;
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
		border: 1px solid var(--line-bright);
		border-radius: 20px;
		background: transparent;
		transition:
			background 140ms ease,
			border-color 140ms ease;
	}
	.thumb {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--muted);
		transition:
			transform 140ms ease,
			background 140ms ease;
	}
	input:checked + .track {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	input:checked + .track .thumb {
		transform: translateX(14px);
		background: var(--accent);
	}
	input:focus-visible + .track {
		outline: 1px solid var(--accent);
		outline-offset: 3px;
	}
</style>
