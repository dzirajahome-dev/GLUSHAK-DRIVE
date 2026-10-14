(() => {
	const dialog = document.querySelector("#support-dialog");
	const form = document.querySelector("#support-form");
	const amountInput = document.querySelector("#support-amount");
	const feedback = document.querySelector("#support-feedback");
	const submit = document.querySelector("#support-submit");
	const details = document.querySelector("#support-details");
	const area = document.querySelector(".support-area");
	let transferDetails = null;
	const text = (key) => window.siteText(key);

	async function loadSupportStatus() {
		const response = await fetch("/api/support/status", { cache: "no-store" });
		if (!response.ok) throw new Error(`Support status request failed: ${response.status}`);
		const status = await response.json();
		if (!status.enabled) {
			dialog.close();
			transferDetails = null;
			details.hidden = true;
			document.querySelector("#support-holder").textContent = "";
			document.querySelector("#support-iban").textContent = "";
			document.querySelector("#support-transfer-amount").textContent = "";
			document.querySelector("#support-title-value").textContent = "";
		}
		area.hidden = !status.enabled;
	}

	function renderTransferDetails() {
		if (!transferDetails) return;
		document.querySelector("#support-holder").textContent = transferDetails.holder;
		document.querySelector("#support-iban").textContent = transferDetails.iban.match(/.{1,4}/g).join(" ");
		document.querySelector("#support-transfer-amount").textContent = new Intl.NumberFormat(window.siteLocale(), {
			style: "currency",
			currency: transferDetails.currency,
		}).format(transferDetails.amountGrosze / 100);
		document.querySelector("#support-title-value").textContent = transferDetails.title;
	}

	document.querySelector("#support-open").addEventListener("click", () => {
		feedback.hidden = true;
		feedback.className = "account-error";
		transferDetails = null;
		details.hidden = true;
		dialog.showModal();
		amountInput.focus();
	});
	document.querySelector("#support-close").addEventListener("click", () => dialog.close());
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) dialog.close();
	});
	document.addEventListener("languagechange", renderTransferDetails);
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		feedback.hidden = true;
		feedback.className = "account-error";
		details.hidden = true;
		transferDetails = null;
		submit.disabled = true;
		submit.textContent = text("support_loading");
		try {
			const response = await fetch("/api/support/transfer-details", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ amount: amountInput.value }),
			});
			const result = await response.json();
			if (!response.ok) {
				const errorKeys = {
					"Kwota musi wynosić od 1 do 1 000 000 zł i mieć maksymalnie dwa miejsca po przecinku.": "support_invalid_amount",
					"Dane rachunku do wsparcia nie zostały jeszcze skonfigurowane.": "support_not_configured",
					"Wsparcie przelewem jest obecnie wyłączone.": "support_disabled",
				};
				throw new Error(text(errorKeys[result.error] || "support_error"));
			}
			transferDetails = result;
			renderTransferDetails();
			details.hidden = false;
		} catch (error) {
			if (error instanceof TypeError) console.error("Nie udało się pobrać danych przelewu wsparcia.", error);
			feedback.textContent = error instanceof TypeError ? text("support_network_error") : error.message;
			feedback.hidden = false;
		} finally {
			submit.disabled = false;
			submit.textContent = text("support_show_transfer");
		}
	});
	loadSupportStatus().catch((error) => {
		console.error("Nie udało się sprawdzić, czy wsparcie przelewem jest włączone.", error);
		area.hidden = true;
	});
	window.setInterval(() => {
		loadSupportStatus().catch((error) => {
			console.error("Nie udało się odświeżyć widoczności przycisku wsparcia.", error);
		});
	}, 15000);
})();
