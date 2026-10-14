(() => {
	const dialog = document.querySelector("#works-dialog");
	const openButton = document.querySelector("#works-open");
	const closeButton = document.querySelector("#works-close");
	const addForm = document.querySelector("#work-add-form");
	const titleInput = document.querySelector("#work-title-input");
	const urlInput = document.querySelector("#work-url-input");
	const submitButton = document.querySelector("#work-submit");
	const formStatus = document.querySelector("#work-form-status");
	const status = document.querySelector("#works-status");
	const grid = document.querySelector("#work-grid");
	const text = (key) => window.siteText(key);
	let isAdmin = false;
	let loadRequestId = 0;

	function setStatus(element, key, isError = false) {
		element.textContent = text(key);
		element.hidden = false;
		element.classList.toggle("error", isError);
	}

	function renderWorks(works) {
		grid.replaceChildren();
		if (!works.length) {
			setStatus(status, "works_empty");
			return;
		}
		status.hidden = true;
		for (const work of works) {
			const card = document.createElement("article");
			card.className = "work-card";
			const heading = document.createElement("h3");
			heading.textContent = work.title;
			const player = document.createElement("iframe");
			player.className = "work-video";
			player.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(work.videoId)}`;
			player.title = `${text("work_video_title")}: ${work.title}`;
			player.loading = "lazy";
			player.referrerPolicy = "strict-origin-when-cross-origin";
			player.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
			player.allowFullscreen = true;
			card.append(heading, player);
			if (isAdmin) {
				const footer = document.createElement("div");
				footer.className = "work-card-footer";
				const removeButton = document.createElement("button");
				removeButton.className = "work-remove";
				removeButton.type = "button";
				removeButton.dataset.removeWork = work.id;
				removeButton.textContent = text("work_remove");
				footer.append(removeButton);
				card.append(footer);
			}
			grid.append(card);
		}
	}

	async function loadWorks() {
		const requestId = ++loadRequestId;
		status.hidden = true;
		grid.replaceChildren();
		try {
			const response = await fetch("/api/works", { cache: "no-store" });
			if (!response.ok) throw new Error(text("works_load_error"));
			const result = await response.json();
			if (requestId !== loadRequestId) return;
			renderWorks(result.works);
		} catch (error) {
			if (requestId !== loadRequestId) return;
			console.error("Nie udało się wczytać prac.", error);
			setStatus(status, "works_load_error", true);
		}
	}

	async function setAdminState(user) {
		isAdmin = user?.role === "admin";
		addForm.hidden = !isAdmin;
		if (dialog.open) await loadWorks();
	}

	openButton.addEventListener("click", () => {
		dialog.showModal();
		void loadWorks();
	});
	closeButton.addEventListener("click", () => dialog.close());
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) dialog.close();
	});
	document.addEventListener("authchange", (event) => {
		void setAdminState(event.detail?.user);
	});
	document.addEventListener("languagechange", () => {
		if (dialog.open) void loadWorks();
	});
	addForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		formStatus.hidden = true;
		submitButton.disabled = true;
		try {
			const response = await fetch("/api/works", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: titleInput.value, url: urlInput.value }),
			});
			if (!response.ok) {
				const key = response.status === 400 ? "work_invalid" : response.status === 401 || response.status === 403 ? "work_admin_only" : "work_save_error";
				throw new Error(text(key));
			}
			addForm.reset();
			setStatus(formStatus, "work_saved");
			await loadWorks();
		} catch (error) {
			if (error instanceof TypeError) console.error("Nie udało się zapisać pracy.", error);
			setStatus(formStatus, error instanceof TypeError ? "work_network_error" : error.message, true);
		} finally {
			submitButton.disabled = false;
		}
	});
	grid.addEventListener("click", async (event) => {
		const button = event.target.closest("[data-remove-work]");
		if (!button || !isAdmin) return;
		button.disabled = true;
		try {
			const response = await fetch(`/api/works/${encodeURIComponent(button.dataset.removeWork)}`, { method: "DELETE" });
			if (!response.ok) throw new Error(text(response.status === 401 || response.status === 403 ? "work_admin_only" : "work_remove_error"));
			await loadWorks();
		} catch (error) {
			console.error("Nie udało się usunąć pracy.", error);
			setStatus(status, error instanceof TypeError ? "work_network_error" : error.message, true);
			button.disabled = false;
		}
	});
	fetch("/api/auth/me", { cache: "no-store" })
		.then((response) => {
			if (!response.ok) throw new Error(`Session request failed: ${response.status}`);
			return response.json();
		})
		.then((result) => setAdminState(result.user))
		.catch((error) => console.error("Nie udało się sprawdzić uprawnień do dodawania prac.", error));
})();
