<svelte:head>
	<title>itsaagent</title>
	<meta name="description" content="AI agents, wired for the terminal." />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main>
	<div class="container">
		<div class="prompt-line">
			<span class="prompt-symbol">$</span>
			<span class="prompt-path">~/agents</span>
		</div>

		<h1 class="brand">itsaagent</h1>

		<p class="tagline">AI agents, wired for the terminal.</p>

		<div class="coming-soon">
			<span class="label">coming soon</span><span class="cursor">_</span>
		</div>

		<div class="divider"></div>

		<p class="sub">
			Something powerful is booting up.<br />
			Local. Fast. No cloud required.
		</p>
	</div>
</main>

<style>
	:global(*, *::before, *::after) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(html, body) {
		height: 100%;
		background: #0a0a0f;
	}

	main {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'JetBrains Mono', 'Courier New', monospace;
		background: #0a0a0f;
		background-image:
			radial-gradient(ellipse at 20% 50%, rgba(120, 40, 200, 0.06) 0%, transparent 60%),
			radial-gradient(ellipse at 80% 20%, rgba(0, 200, 220, 0.05) 0%, transparent 60%);
		color: #c8c8d4;
		padding: 2rem;
	}

	.container {
		text-align: center;
		max-width: 640px;
		width: 100%;
	}

	.prompt-line {
		font-size: 0.75rem;
		margin-bottom: 2.5rem;
		opacity: 0.45;
		letter-spacing: 0.05em;
	}

	.prompt-symbol {
		color: #7c3aed;
		margin-right: 0.4em;
	}

	.prompt-path {
		color: #22d3ee;
	}

	h1.brand {
		font-size: clamp(2.8rem, 8vw, 5.5rem);
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1;
		margin-bottom: 1.25rem;
		background: linear-gradient(135deg, #a855f7 0%, #22d3ee 50%, #a855f7 100%);
		background-size: 200% auto;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		animation: shimmer 4s linear infinite;
		filter: drop-shadow(0 0 32px rgba(168, 85, 247, 0.3));
	}

	@keyframes shimmer {
		0% { background-position: 0% center; }
		100% { background-position: 200% center; }
	}

	.tagline {
		font-size: clamp(0.9rem, 2.5vw, 1.1rem);
		font-weight: 300;
		color: #94a3b8;
		letter-spacing: 0.04em;
		margin-bottom: 2.5rem;
	}

	.coming-soon {
		display: inline-flex;
		align-items: center;
		gap: 0;
		font-size: 0.85rem;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		color: #4b5563;
		margin-bottom: 2.5rem;
	}

	.label {
		color: #6b7280;
	}

	.cursor {
		color: #a855f7;
		animation: blink 1.1s step-start infinite;
		font-weight: 700;
		margin-left: 1px;
	}

	@keyframes blink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0; }
	}

	.divider {
		width: 48px;
		height: 1px;
		background: linear-gradient(90deg, transparent, #7c3aed, #22d3ee, transparent);
		margin: 0 auto 2.5rem;
		opacity: 0.5;
	}

	.sub {
		font-size: 0.8rem;
		font-weight: 300;
		color: #374151;
		letter-spacing: 0.05em;
		line-height: 1.8;
	}
</style>
