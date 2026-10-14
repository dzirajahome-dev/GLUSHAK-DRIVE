(() => {
	const consentPanel = document.querySelector("#analytics-consent");
	const consentKey = "glushak-analytics-consent-v2";
	const sessionKey = "glushak-analytics-session";

	function getSessionId() {
		let sessionId = sessionStorage.getItem(sessionKey);
		if (!sessionId) {
			sessionId = crypto.randomUUID();
			sessionStorage.setItem(sessionKey, sessionId);
		}
		return sessionId;
	}

	function sendEvent(type, target) {
		fetch("/api/track", {
			method: "POST",
			keepalive: true,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type,
				target,
				session: getSessionId(),
				referrer: type === "pageview" ? document.referrer : undefined,
			}),
		}).catch(() => {});
	}

	function enableAnalytics() {
		sendEvent("pageview");
		document.querySelectorAll(".social-link[data-platform]").forEach((link) => {
			link.addEventListener("click", () => sendEvent("click", link.dataset.platform));
		});
	}

	try {
		const consent = localStorage.getItem(consentKey);
		if (consent === "yes") {
			enableAnalytics();
		} else if (consent !== "no") {
			consentPanel.hidden = false;
			consentPanel.querySelectorAll("[data-consent]").forEach((button) => {
				button.addEventListener("click", () => {
					localStorage.setItem(consentKey, button.dataset.consent);
					consentPanel.hidden = true;
					if (button.dataset.consent === "yes") enableAnalytics();
				});
			});
		}
	} catch {
		consentPanel.hidden = true;
	}
})();