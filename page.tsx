const socialLinks = [
	{
		name: "TikTok",
		href: "https://www.tiktok.com/",
		logo: (
			<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
				<path fill="#25F4EE" transform="translate(-0.45 0.25)" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.06 1.75 4.13 1.12 1.1 2.7 1.58 4.23 1.65v4.01c-1.43-.05-2.86-.35-4.17-.96-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.36 3.93-1.32 1.92-3.62 3.17-5.95 3.21-1.43.08-2.86-.31-4.07-1.07-2-1.25-3.37-3.48-3.58-5.83-.02-.5-.03-1.01-.01-1.51.18-1.92 1.12-3.78 2.63-5.02 1.7-1.44 4.1-2.13 6.3-1.74.02 1.48-.04 2.96-.04 4.44-1-.32-2.17-.23-3.03.39-.62.42-1.1 1.07-1.25 1.8-.13.58-.1 1.2.06 1.78.41 1.32 1.75 2.2 3.12 2.1.91-.02 1.79-.53 2.3-1.28.16-.28.3-.58.37-.9.1-1.69.05-3.38.06-5.07.01-3.87-.01-7.73.03-11.6z" />
				<path fill="#FE2C55" transform="translate(0.45 -0.25)" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.06 1.75 4.13 1.12 1.1 2.7 1.58 4.23 1.65v4.01c-1.43-.05-2.86-.35-4.17-.96-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.36 3.93-1.32 1.92-3.62 3.17-5.95 3.21-1.43.08-2.86-.31-4.07-1.07-2-1.25-3.37-3.48-3.58-5.83-.02-.5-.03-1.01-.01-1.51.18-1.92 1.12-3.78 2.63-5.02 1.7-1.44 4.1-2.13 6.3-1.74.02 1.48-.04 2.96-.04 4.44-1-.32-2.17-.23-3.03.39-.62.42-1.1 1.07-1.25 1.8-.13.58-.1 1.2.06 1.78.41 1.32 1.75 2.2 3.12 2.1.91-.02 1.79-.53 2.3-1.28.16-.28.3-.58.37-.9.1-1.69.05-3.38.06-5.07.01-3.87-.01-7.73.03-11.6z" />
				<path fill="#fff" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.06 1.75 4.13 1.12 1.1 2.7 1.58 4.23 1.65v4.01c-1.43-.05-2.86-.35-4.17-.96-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.36 3.93-1.32 1.92-3.62 3.17-5.95 3.21-1.43.08-2.86-.31-4.07-1.07-2-1.25-3.37-3.48-3.58-5.83-.02-.5-.03-1.01-.01-1.51.18-1.92 1.12-3.78 2.63-5.02 1.7-1.44 4.1-2.13 6.3-1.74.02 1.48-.04 2.96-.04 4.44-1-.32-2.17-.23-3.03.39-.62.42-1.1 1.07-1.25 1.8-.13.58-.1 1.2.06 1.78.41 1.32 1.75 2.2 3.12 2.1.91-.02 1.79-.53 2.3-1.28.16-.28.3-.58.37-.9.1-1.69.05-3.38.06-5.07.01-3.87-.01-7.73.03-11.6z" />
			</svg>
		),
	},
	{
		name: "Instagram",
		href: "https://www.instagram.com/glushak_drive?dlrf=NW80Nnpyd2w1am54",
		logo: (
			<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
				<rect x="3" y="3" width="18" height="18" rx="5" />
				<circle cx="12" cy="12" r="4" />
				<circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
			</svg>
		),
	},
	{
		name: "YouTube",
		href: "https://www.youtube.com/@GLUSHAKDRIVE",
		logo: (
			<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
				<path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8Z" />
				<path fill="#183d32" d="m9.6 15.5 6.2-3.5-6.2-3.5z" />
			</svg>
		),
	},
];

export default function Page() {
	return (
		<>
			<style>{`
				:root { color-scheme: dark; font-family: "Arial Narrow", "Roboto Condensed", Impact, sans-serif; background: #090a0e; color: #f4f3f1; font-synthesis: none; text-rendering: optimizeLegibility; }
				* { box-sizing: border-box; }
				body { min-width: 320px; min-height: 100vh; margin: 0; background: repeating-linear-gradient(135deg, transparent 0 42px, #ffffff04 43px 44px), #090a0e; }
				.page-shell { width: min(100% - 48px, 1060px); margin: 0 auto; padding: 40px 0 64px; }
				.banner { display: block; width: 100%; aspect-ratio: 1060 / 175; object-fit: cover; border-bottom: 3px solid #e5233e; animation: reveal 650ms ease-out both; }
				.identity { display: flex; align-items: center; gap: 24px; padding: 24px 0 30px; animation: reveal 700ms 100ms ease-out both; }
				.avatar { width: 116px; height: 116px; flex: 0 0 116px; border: 3px solid #e5233e; border-radius: 50%; object-fit: cover; }
				h1 { margin: 0; color: #fff; font-size: clamp(30px, 6vw, 54px); line-height: 1; text-transform: uppercase; }
				.handle { margin: 10px 0 0; color: #aeb0b7; font-family: Arial, sans-serif; font-size: 14px; }
				.social-area { border-top: 1px solid #ffffff24; padding-top: 22px; animation: reveal 700ms 180ms ease-out both; }
				h2 { margin: 0 0 14px; color: #92949c; font-family: Arial, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 2px; }
				.social-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
				.social-link { min-height: 60px; padding: 0 20px; display: flex; align-items: center; justify-content: center; gap: 11px; border: 1px solid #ffffff20; border-radius: 6px; background: #15161c; color: #f4f3f1; font-size: 17px; font-weight: 700; text-decoration: none; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }
				.social-link svg { width: 24px; height: 24px; flex: 0 0 24px; }
				.social-link:hover { transform: translateY(-2px); border-color: #e5233e; background: #202127; }
				.social-link.youtube { border-color: #e5233e; background: #e5233e; color: #fff; }
				.social-link.youtube:hover { background: #c91d34; }
				.social-link:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
				@keyframes reveal { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
				@media (max-width: 620px) { .page-shell { width: min(100% - 32px, 1060px); padding-top: 20px; } .identity { align-items: flex-start; gap: 16px; padding: 20px 0 24px; } .avatar { width: 76px; height: 76px; flex-basis: 76px; } h1 { font-size: clamp(26px, 8vw, 40px); line-height: 1.05; } .handle { font-size: 12px; } .social-links { grid-template-columns: 1fr; gap: 9px; } .social-link { min-height: 54px; justify-content: flex-start; } }
				@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }
			`}</style>
			<main className="page-shell">
				<img className="banner" src="/channel-banner.jpg" alt="Nocny banner kanału GLUSHAK DRIVE z samochodami" />
				<header className="identity">
					<img className="avatar" src="/channel-avatar.jpg" alt="Logo GLUSHAK DRIVE" />
					<div>
						<h1>GLUSHAK DRIVE</h1>
						<p className="handle">@GLUSHAKDRIVE</p>
					</div>
				</header>
				<section className="social-area" aria-labelledby="social-title">
					<h2 id="social-title">MEDIA SPOŁECZNOŚCIOWE</h2>
					<nav className="social-links" aria-label="Media społecznościowe">
						{socialLinks.map((link) => (
							<a className={`social-link${link.name === "YouTube" ? " youtube" : ""}`} key={link.name} href={link.href} target="_blank" rel="noopener noreferrer">
								{link.logo}
								{link.name}
							</a>
						))}
					</nav>
				</section>
			</main>
		</>
	);
}
