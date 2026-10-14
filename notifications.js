(() => {
	const openButton = document.querySelector("#notifications-open");
	const countBadge = document.querySelector("#notification-count");
	const dialog = document.querySelector("#notifications-dialog");
	const closeButton = document.querySelector("#notifications-close");
	const list = document.querySelector("#notifications-list");
	const markReadButton = document.querySelector("#notifications-mark-read");
	const text = (key) => window.siteText(key);
	const statusKeys = {
		new: "status_new",
		"in-progress": "status_progress",
		completed: "status_completed",
		cancelled: "status_cancelled",
		paid: "status_paid",
		pending: "status_pending",
	};
	let currentUserId = null;
	let notifications = [];
	let refreshTimer = null;
	let loading = false;

	const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
		"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
	})[character]);

	function render() {
		const unreadCount = notifications.filter((item) => !item.read).length;
		countBadge.hidden = unreadCount === 0;
		countBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
		openButton.setAttribute("aria-label", `${text("notifications_button")}${unreadCount ? `, ${unreadCount}` : ""}`);
		markReadButton.disabled = unreadCount === 0;
		if (!notifications.length) {
			list.innerHTML = `<p class="notification-empty">${escapeHtml(text("notifications_empty"))}</p>`;
			return;
		}
		list.innerHTML = notifications.map((item) => {
			let message;
			let href = "/account";
			let openWorks = false;
			if (item.type === "new-work") {
				message = text("notification_new_work").replace("{title}", item.workTitle || "");
				href = "#";
				openWorks = true;
			} else {
				const key = item.type === "payment-status" ? "notification_payment_status" : "notification_order_status";
				const status = statusKeys[item.value] ? text(statusKeys[item.value]) : item.value || "";
				message = text(key)
					.replace("{id}", String(item.orderId || "").slice(0, 8))
					.replace("{status}", status);
			}
			const date = new Date(item.createdAt);
			const dateText = Number.isNaN(date.getTime())
				? ""
				: new Intl.DateTimeFormat(window.siteLocale(), { dateStyle: "medium", timeStyle: "short" }).format(date);
			return `<a class="notification-item${item.read ? "" : " unread"}" href="${href}"${openWorks ? ' data-open-works="true"' : ""}><strong>${escapeHtml(message)}</strong><time datetime="${escapeHtml(item.createdAt)}">${escapeHtml(dateText)}</time></a>`;
		}).join("");
	}

	async function loadNotifications() {
		if (!currentUserId || loading) return;
		loading = true;
		try {
			const response = await fetch("/api/notifications", { credentials: "same-origin", cache: "no-store" });
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || text("notifications_error"));
			notifications = Array.isArray(result.notifications) ? result.notifications : [];
			render();
		} catch (error) {
			console.error("Nie udało się wczytać powiadomień.", error);
			if (dialog.open) list.innerHTML = `<p class="notification-error">${escapeHtml(text("notifications_error"))}</p>`;
		} finally {
			loading = false;
		}
	}

	document.addEventListener("authchange", (event) => {
		const nextUserId = event.detail.user?.id || null;
		openButton.hidden = !nextUserId;
		if (nextUserId === currentUserId) {
			if (nextUserId) loadNotifications();
			return;
		}
		currentUserId = nextUserId;
		notifications = [];
		render();
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = null;
		if (currentUserId) {
			loadNotifications();
			refreshTimer = setInterval(loadNotifications, 30000);
		}
	});

	openButton.addEventListener("click", () => {
		dialog.showModal();
		loadNotifications();
	});
	closeButton.addEventListener("click", () => dialog.close());
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) dialog.close();
	});
	list.addEventListener("click", (event) => {
		const link = event.target.closest("[data-open-works]");
		if (!link) return;
		event.preventDefault();
		dialog.close();
		document.querySelector("#works-open").click();
	});
	markReadButton.addEventListener("click", async () => {
		markReadButton.disabled = true;
		try {
			const response = await fetch("/api/notifications/read", {
				method: "POST",
				credentials: "same-origin",
				cache: "no-store",
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || text("notifications_error"));
			notifications = notifications.map((item) => ({ ...item, read: true }));
			render();
		} catch (error) {
			console.error("Nie udało się oznaczyć powiadomień jako przeczytane.", error);
			markReadButton.disabled = false;
			list.insertAdjacentHTML("afterbegin", `<p class="notification-error" role="alert">${escapeHtml(text("notifications_error"))}</p>`);
		}
	});
	document.addEventListener("languagechange", render);
})();
