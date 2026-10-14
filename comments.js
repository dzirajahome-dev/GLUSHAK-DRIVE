(() => {
	const form = document.querySelector("#comment-form");
	const messageInput = document.querySelector("#comment-message");
	const submitButton = document.querySelector("#comment-submit");
	const status = document.querySelector("#comment-status");
	const loginPrompt = document.querySelector("#comment-login-prompt");
	const loginButton = document.querySelector("#comment-login");
	const list = document.querySelector("#comment-list");
	const count = document.querySelector("#comment-count");
	let signedIn = false;
	let setupAvailable = false;
	let comments = [];
	let loadFailed = false;
	let statusKey = "";
	const text = (key) => window.siteText(key);

	async function requestJson(url, options = {}) {
		const response = await fetch(url, {
			...options,
			credentials: "same-origin",
			cache: "no-store",
			headers: options.body ? { "Content-Type": "application/json" } : undefined,
		});
		const result = await response.json();
		if (!response.ok) {
			const message = result.code === "inappropriate_content"
				? text("comment_inappropriate")
				: result.error === "Zaloguj się, aby dodać komentarz."
					? text("login_required")
				: result.error === "Komentarz musi mieć od 2 do 1000 znaków."
					? text("comment_length_error")
					: text("comment_error");
			throw new Error(message);
		}
		return result;
	}

	function renderComments(items) {
		const plural = new Intl.PluralRules(window.siteLocale()).select(items.length);
		const countKey = plural === "one" ? "comment_count_one" : plural === "few" ? "comment_count_few" : "comment_count_many";
		count.textContent = text(countKey).replace("{count}", String(items.length));
		list.replaceChildren();
		if (items.length === 0) {
			const empty = document.createElement("p");
			empty.className = "comment-empty";
			empty.textContent = text("empty_comments");
			list.append(empty);
			return;
		}
		for (const comment of items) {
			const item = document.createElement("article");
			item.className = "comment-item";
			const meta = document.createElement("div");
			meta.className = "comment-meta";
			const name = document.createElement("strong");
			name.textContent = comment.name;
			const time = document.createElement("time");
			time.dateTime = comment.createdAt;
			time.textContent = new Intl.DateTimeFormat(window.siteLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(comment.createdAt));
			const message = document.createElement("p");
			message.className = "comment-message";
			message.textContent = comment.message;
			meta.append(name, time);
			item.append(meta, message);
			list.append(item);
		}
	}

	async function loadComments() {
		try {
			const result = await requestJson("/api/comments");
			loadFailed = false;
			comments = result.comments;
			renderComments(result.comments);
		} catch {
			loadFailed = true;
			count.textContent = "";
			list.replaceChildren();
			const error = document.createElement("p");
			error.className = "comment-empty";
			error.setAttribute("role", "alert");
			error.textContent = text("load_comments_error");
			list.append(error);
		}
	}

	function setUser(user, availableSetup = false) {
		signedIn = Boolean(user);
		form.hidden = !signedIn;
		loginPrompt.hidden = signedIn;
		setupAvailable = availableSetup;
	}

	document.addEventListener("authchange", (event) => {
		setUser(event.detail.user, event.detail.setupAvailable);
	});
	loginButton.addEventListener("click", () => {
		document.querySelector(setupAvailable ? "#register-action" : "#login-action").click();
	});
	document.addEventListener("languagechange", () => {
		if (loadFailed) {
			const error = list.querySelector('[role="alert"]');
			if (error) error.textContent = text("load_comments_error");
		} else {
			renderComments(comments);
		}
		if (statusKey) status.textContent = text(statusKey);
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		status.removeAttribute("role");
		status.textContent = "";
		submitButton.disabled = true;
		try {
			const result = await requestJson("/api/comments", {
				method: "POST",
				body: JSON.stringify({ message: messageInput.value }),
			});
			messageInput.value = "";
			statusKey = "comment_success";
			status.textContent = text(statusKey);
			comments = [result.comment, ...comments].slice(0, 100);
			renderComments(comments);
			messageInput.focus();
		} catch (error) {
			status.setAttribute("role", "alert");
			statusKey = error.message === text("comment_length_error") ? "comment_length_error" : "";
			if (error.message === text("comment_inappropriate")) statusKey = "comment_inappropriate";
			status.textContent = statusKey ? text(statusKey) : error.message === text("login_required") ? text("login_required") : text("comment_error");
		} finally {
			submitButton.disabled = false;
		}
	});

	setUser(null);
	loadComments();
})();
