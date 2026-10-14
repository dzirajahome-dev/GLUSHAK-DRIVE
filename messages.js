(() => {
	const dialog = document.querySelector("#messages-dialog");
	const contactForm = document.querySelector("#message-contact-form");
	const emailInput = document.querySelector("#friend-email");
	const form = document.querySelector("#message-form");
	const messageInput = document.querySelector("#friend-message");
	const feedback = document.querySelector("#message-feedback");
	const submit = document.querySelector("#message-submit");
	const imageInput = document.querySelector("#message-image");
	const imageButton = document.querySelector("#message-image-select");
	const imagePreview = document.querySelector("#message-image-preview");
	const imagePreviewContent = document.querySelector("#message-image-preview-content");
	const conversationList = document.querySelector("#conversation-list");
	const messageList = document.querySelector("#message-list");
	const chatName = document.querySelector("#chat-name");
	const chatAvatar = document.querySelector("#chat-avatar");
	const chatStatus = document.querySelector("#chat-status");
	let messages = [];
	let activeConversationId = "";
	let pendingRecipientEmail = "";
	let loadFailed = false;
	let selectedImage = null;
	let imagePreviewUrl = "";
	const text = (key) => window.siteText(key);
	const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	})[character]);

	function clearSelectedImage() {
		if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
		imagePreviewUrl = "";
		selectedImage = null;
		imageInput.value = "";
		imagePreview.hidden = true;
		imagePreviewContent.replaceChildren();
	}

	function formatTime(value) {
		return new Intl.DateTimeFormat(window.siteLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
	}

	function getConversations() {
		const conversations = new Map();
		for (const message of messages) {
			if (!message.conversationId) continue;
			const current = conversations.get(message.conversationId);
			if (!current || message.sentAt > current.lastMessage.sentAt) {
				conversations.set(message.conversationId, {
					id: message.conversationId,
					name: message.conversationName || (message.direction === "sent" ? message.recipientName : message.senderName),
					lastMessage: message,
				});
			}
		}
		return [...conversations.values()].sort((left, right) => right.lastMessage.sentAt.localeCompare(left.lastMessage.sentAt));
	}

	function renderConversations() {
		const conversations = getConversations();
		if (!conversations.length) {
			conversationList.innerHTML = `<p>${escapeHtml(text("messages_empty"))}</p>`;
			return;
		}
		conversationList.innerHTML = conversations.map((conversation) => {
			const active = conversation.id === activeConversationId;
			const preview = conversation.lastMessage.message || (conversation.lastMessage.imageUrl ? text("message_image_preview") : "");
			return `<button class="conversation-button" type="button" data-conversation-id="${escapeHtml(conversation.id)}" aria-current="${active}">
				<span class="conversation-avatar" aria-hidden="true">${escapeHtml(conversation.name.trim().charAt(0).toUpperCase() || "?")}</span>
				<span class="conversation-copy"><strong class="conversation-name">${escapeHtml(conversation.name)}</strong><span class="conversation-preview">${escapeHtml(preview)}</span></span>
			</button>`;
		}).join("");
	}

	function renderThread() {
		const conversation = getConversations().find((item) => item.id === activeConversationId);
		const isNew = activeConversationId.startsWith("new:");
		if (!conversation && !isNew) {
			chatName.textContent = text("messages_choose_chat");
			chatAvatar.textContent = "?";
			chatStatus.textContent = "";
			messageInput.disabled = true;
			submit.disabled = true;
			imageButton.disabled = true;
			imageInput.disabled = true;
			messageList.innerHTML = `<p>${escapeHtml(text("messages_choose_chat"))}</p>`;
			return;
		}

		const name = conversation?.name || pendingRecipientEmail;
		chatName.textContent = name;
		chatAvatar.textContent = name.trim().charAt(0).toUpperCase() || "?";
		chatStatus.textContent = isNew ? text("messages_new_chat") : text("messages_private_chat");
		messageInput.disabled = false;
		submit.disabled = false;
		imageButton.disabled = false;
		imageInput.disabled = false;
		const threadMessages = messages.filter((message) => message.conversationId === activeConversationId)
			.sort((left, right) => left.sentAt.localeCompare(right.sentAt));
		if (!threadMessages.length) {
			messageList.innerHTML = `<p>${escapeHtml(text("messages_start_chat_prompt"))}</p>`;
			return;
		}
		messageList.innerHTML = threadMessages.map((message) => `
			<article class="chat-message ${message.direction === "sent" ? "sent" : "received"}">
				${message.imageUrl ? `<img class="chat-image" src="${escapeHtml(message.imageUrl)}" alt="${escapeHtml(text("message_image_alt"))}" loading="lazy">` : ""}
				${message.message ? `<div class="chat-bubble">${escapeHtml(message.message)}</div>` : ""}
				<time datetime="${escapeHtml(message.sentAt)}">${escapeHtml(formatTime(message.sentAt))}</time>
			</article>`).join("");
		messageList.scrollTop = messageList.scrollHeight;
	}

	function renderMessages() {
		renderConversations();
		renderThread();
	}

	async function loadMessages() {
		conversationList.innerHTML = `<p>${escapeHtml(text("messages_loading"))}</p>`;
		const response = await fetch("/api/messages", { cache: "no-store", credentials: "same-origin" });
		if (response.status === 401) {
			conversationList.innerHTML = `<p>${escapeHtml(text("login_required"))}</p>`;
			return;
		}
		if (!response.ok) throw new Error(text("messages_load_error"));
		const result = await response.json();
		messages = result.messages;
		loadFailed = false;
		if (!getConversations().some((conversation) => conversation.id === activeConversationId)) {
			activeConversationId = getConversations()[0]?.id || "";
			pendingRecipientEmail = "";
		}
		renderMessages();
	}

	document.querySelector("#messages-open").addEventListener("click", () => {
		feedback.hidden = true;
		feedback.className = "account-error";
		messageInput.value = "";
		clearSelectedImage();
		pendingRecipientEmail = "";
		activeConversationId = "";
		dialog.showModal();
		loadMessages().catch((error) => {
			console.error("Nie udało się wczytać prywatnych wiadomości.", error);
			loadFailed = true;
			conversationList.innerHTML = `<p>${escapeHtml(text("messages_load_error"))}</p>`;
		});
	});
	document.querySelector("#messages-close").addEventListener("click", () => dialog.close());
	dialog.addEventListener("close", clearSelectedImage);
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) dialog.close();
	});
	conversationList.addEventListener("click", (event) => {
		const button = event.target.closest("[data-conversation-id]");
		if (!button) return;
		activeConversationId = button.dataset.conversationId;
		pendingRecipientEmail = "";
		feedback.hidden = true;
		renderMessages();
		messageInput.focus();
	});
	contactForm.addEventListener("submit", (event) => {
		event.preventDefault();
		pendingRecipientEmail = emailInput.value.trim().toLowerCase();
		activeConversationId = `new:${pendingRecipientEmail}`;
		messageInput.value = "";
		clearSelectedImage();
		feedback.hidden = true;
		renderMessages();
		messageInput.focus();
	});
	imageButton.addEventListener("click", () => imageInput.click());
	imageInput.addEventListener("change", () => {
		const image = imageInput.files[0];
		if (!image) return;
		if (!["image/jpeg", "image/png"].includes(image.type)) {
			clearSelectedImage();
			feedback.textContent = text("message_image_invalid");
			feedback.hidden = false;
			return;
		}
		if (image.size > 5 * 1024 * 1024) {
			clearSelectedImage();
			feedback.textContent = text("message_image_too_large");
			feedback.hidden = false;
			return;
		}
		if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
		selectedImage = image;
		imagePreviewUrl = URL.createObjectURL(image);
		imagePreviewContent.replaceChildren();
		const thumbnail = document.createElement("img");
		thumbnail.src = imagePreviewUrl;
		thumbnail.alt = text("message_image_alt");
		imagePreviewContent.append(thumbnail);
		imagePreview.hidden = false;
		feedback.hidden = true;
	});
	document.querySelector("#message-image-remove").addEventListener("click", clearSelectedImage);
	document.addEventListener("languagechange", () => {
		if (!dialog.open) return;
		if (loadFailed) conversationList.innerHTML = `<p>${escapeHtml(text("messages_load_error"))}</p>`;
		else renderMessages();
	});
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const messageText = messageInput.value.trim();
		if (!messageText && !selectedImage) return;
		feedback.hidden = true;
		feedback.className = "account-error";
		submit.disabled = true;
		imageButton.disabled = true;
		try {
			const isNewConversation = activeConversationId.startsWith("new:");
			const payload = {
				message: messageText,
				...(selectedImage ? {
					image: {
						mimeType: selectedImage.type,
						data: await selectedImage.arrayBuffer().then((buffer) => {
							const bytes = new Uint8Array(buffer);
							let binary = "";
							for (let offset = 0; offset < bytes.length; offset += 0x8000) {
								binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
							}
							return btoa(binary);
						}),
					},
				} : {}),
				...(isNewConversation
					? { email: pendingRecipientEmail }
					: { recipientId: activeConversationId }),
			};
			const response = await fetch("/api/messages", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const result = await response.json();
			if (!response.ok) {
				const errors = {
					"Wpisz prawidłowy e-mail znajomego.": "message_invalid_email",
					"Wiadomość musi mieć od 1 do 2000 znaków.": "message_length_error",
					"Nie możesz wysłać wiadomości do siebie.": "message_self_error",
					"Nie znaleziono zarejestrowanego konta o tym adresie e-mail.": "message_no_account",
					"Wybierz obraz JPG lub PNG.": "message_image_invalid",
					"Wybierz statyczny obraz JPG lub PNG.": "message_image_invalid",
					"Obraz przekracza limit 5 MB.": "message_image_too_large",
					"Obraz ma nieprawidłowe lub zbyt duże wymiary.": "message_image_invalid",
					"Obraz może zawierać niedozwolone treści i nie został wysłany.": "message_image_inappropriate",
					"Moderacja obrazu jest chwilowo niedostępna. Spróbuj ponownie później.": "message_moderation_unavailable",
					"Request too large": "message_image_too_large",
				};
				throw new Error(text(errors[result.error] || "message_send_error"));
			}
			messages.push(result.message);
			activeConversationId = result.message.conversationId;
			pendingRecipientEmail = "";
			messageInput.value = "";
			clearSelectedImage();
			feedback.textContent = text("message_send_success");
			feedback.classList.add("success");
			feedback.hidden = false;
			renderMessages();
			messageInput.focus();
		} catch (error) {
			if (error instanceof TypeError) console.error("Nie udało się wysłać prywatnej wiadomości.", error);
			feedback.textContent = error instanceof TypeError ? text("message_network_error") : error.message;
			feedback.hidden = false;
		} finally {
			submit.disabled = false;
			imageButton.disabled = !activeConversationId;
		}
	});
})();
