(() => {
	const container = document.querySelector("#community-badges");
	const text = (key) => window.siteText(key);
	const badgeKeys = {
		"first-comment": ["badge_first_comment", "badge_first_comment_desc"],
		"active-voice": ["badge_active_voice", "badge_active_voice_desc"],
		"community-voice": ["badge_community_voice", "badge_community_voice_desc"],
	};
	let badges = [];
	let commentCount = 0;

	function render() {
		if (!badges.length) return;
		container.innerHTML = badges.map((badge) => {
			const keys = badgeKeys[badge.id];
			if (!keys) return "";
			const progress = text("badges_progress")
				.replace("{count}", new Intl.NumberFormat(window.siteLocale()).format(commentCount))
				.replace("{threshold}", new Intl.NumberFormat(window.siteLocale()).format(badge.threshold));
			return `<article class="community-badge${badge.earned ? " earned" : ""}"><strong>${text(keys[0])}</strong><p>${text(keys[1])}</p><span>${badge.earned ? text("badge_earned") : progress}</span></article>`;
		}).join("");
	}

	async function load() {
		try {
			const response = await fetch("/api/community/badges", { credentials: "same-origin", cache: "no-store" });
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || text("badges_load_error"));
			badges = Array.isArray(result.badges) ? result.badges : [];
			commentCount = Number(result.commentCount) || 0;
			render();
		} catch (error) {
			console.error("Nie udało się wczytać odznak społeczności.", error);
			container.innerHTML = `<p class="empty">${text("badges_load_error")}</p>`;
		}
	}

	document.addEventListener("languagechange", render);
	load();
})();
