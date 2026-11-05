<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		kicker?: string;
		open?: boolean;
		children: Snippet;
	}

	let { title, kicker = '', open = false, children }: Props = $props();
</script>

<details class="section" open={open}>
	<summary>
		<span class="title">{title}</span>
		{#if kicker}<span class="kicker">{kicker}</span>{/if}
		<span class="mark" aria-hidden="true"></span>
	</summary>
	<div class="body">{@render children()}</div>
</details>

<style>
	.section {
		border-top: 1px solid var(--line-strong);
	}
	summary {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 0 10px;
		list-style: none;
		cursor: pointer;
		user-select: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary:hover .title {
		opacity: 0.55;
	}
	.title {
		font-family: var(--sans);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.015em;
		text-transform: uppercase;
		color: var(--ink);
		transition: opacity 120ms ease;
	}
	.kicker {
		margin-left: auto;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.03em;
		color: var(--muted);
	}
	.mark {
		position: relative;
		width: 8px;
		height: 8px;
		margin-left: auto;
		flex: 0 0 auto;
	}
	.kicker + .mark {
		margin-left: 4px;
	}
	.mark::before,
	.mark::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 0;
		width: 8px;
		height: 1px;
		background: var(--ink);
		transition: transform 140ms ease;
	}
	.mark::after {
		transform: rotate(90deg);
	}
	details[open] .mark::after {
		transform: rotate(0deg);
	}
	.body {
		padding: 0 0 14px;
	}
</style>
