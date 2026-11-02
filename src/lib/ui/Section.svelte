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
		border-top: 1px solid var(--line);
	}
	summary {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 15px 0 13px;
		list-style: none;
		cursor: pointer;
		user-select: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.title {
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--paper);
	}
	.kicker {
		margin-left: auto;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.mark {
		position: relative;
		width: 9px;
		height: 9px;
		margin-left: auto;
		flex: 0 0 auto;
	}
	.kicker + .mark {
		margin-left: 2px;
	}
	.mark::before,
	.mark::after {
		content: '';
		position: absolute;
		top: 4px;
		left: 0;
		width: 9px;
		height: 1px;
		background: var(--muted);
		transition: transform 160ms ease;
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
