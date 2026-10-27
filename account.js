(() => {
	const profileTrigger = document.querySelector("#profile-trigger");
	const profileMenu = document.querySelector("#profile-menu");
	const profileLabel = document.querySelector("#profile-label");
	const profileName = document.querySelector("#profile-name");
	const profileRole = document.querySelector("#profile-role");
	const accountLink = document.querySelector("#account-link");
	const studioLink = document.querySelector("#studio-link");
	const messagesOpen = document.querySelector("#messages-open");
	const loginAction = document.querySelector("#login-action");
	const registerAction = document.querySelector("#register-action");
	const logoutAction = document.querySelector("#logout-action");
	const dialog = document.querySelector("#account-dialog");
	const form = document.querySelector("#account-form");
	const formTitle = document.querySelector("#account-title");
	const formEyebrow = document.querySelector("#dialog-eyebrow");
	const formHelp = document.querySelector("#dialog-help");
	const formError = document.querySelector("#account-error");
	const nameField = document.querySelector("#name-field");
	const accountName = document.querySelector("#account-name");
	const accountEmail = document.querySelector("#account-email");
	const accountPassword = document.querySelector("#account-password");
	const submitButton = document.querySelector("#account-submit");
	const modeSwitch = document.querySelector("#account-switch");
	const resetOpenButton = document.querySelector("#password-reset-open");
	const resetDialog = document.querySelector("#password-reset-dialog");
	const resetEmail = document.querySelector("#password-reset-email");
	const resetRequestForm = document.querySelector("#password-reset-request-form");
	const resetRequestStatus = document.querySelector("#password-reset-request-status");
	const resetConfirmForm = document.querySelector("#password-reset-confirm-form");
	const resetConfirmStatus = document.querySelector("#password-reset-confirm-status");
	const resetCode = document.querySelector("#password-reset-code");
	const resetPassword = document.querySelector("#password-reset-password");
	const resetSendButton = document.querySelector("#password-reset-send");
	const resetConfirmButton = document.querySelector("#password-reset-confirm");
	const state = { user: null, setupAvailable: false, mode: "login" };
	const text = (key) => window.siteText(key);

	function closeMenu() {
		profileMenu.hidden = true;
		profileTrigger.setAttribute("aria-expanded", "false");
	}

	function renderProfile() {
		const user = state.user;
		profileLabel.textContent = user ? user.name : text("profile");
		profileName.textContent = user ? user.name : state.setupAvailable ? text("setup_available") : text("guest");
		profileRole.textContent = user
			? user.role === "admin" ? text("role_admin") : user.email
			: state.setupAvailable ? text("create_admin_hint") : text("not_logged_in");
		accountLink.hidden = !user;
		studioLink.hidden = user?.role !== "admin";
		messagesOpen.hidden = !user;
		loginAction.hidden = Boolean(user) || state.setupAvailable;
		registerAction.hidden = false;
		registerAction.textContent = text(state.setupAvailable ? "create_admin" : "add_account");
		logoutAction.hidden = !user;
		document.dispatchEvent(new CustomEvent("authchange", { detail: { user, setupAvailable: state.setupAvailable } }));
	}

	function clearAuthQuery() {
		const url = new URL(window.location.href);
		url.searchParams.delete("auth");
		window.history.replaceState({}, "", url);
	}

	function setMode(mode) {
		state.mode = mode;
		const isRegister = mode === "register";
		const firstAdmin = isRegister && state.setupAvailable;
		nameField.hidden = !isRegister;
		accountName.required = isRegister;
		accountPassword.autocomplete = isRegister ? "new-password" : "current-password";
		formError.hidden = true;
		formError.textContent = "";
		formTitle.textContent = isRegister
			? firstAdmin ? text("auth_title_admin") : text("auth_title_register")
			: text("auth_title_login");
		formEyebrow.textContent = firstAdmin ? text("auth_eyebrow_admin") : isRegister ? text("auth_eyebrow_register") : text("auth_eyebrow");
		formHelp.textContent = firstAdmin
			? text("auth_help_admin")
			: isRegister
				? state.user?.role === "admin"
					? text("auth_help_register_admin")
					: text("auth_help_register")
				: text("auth_help_login");
		submitButton.textContent = isRegister
			? firstAdmin ? text("auth_submit_admin") : text("auth_submit_register")
			: text("auth_submit_login");
		modeSwitch.hidden = state.setupAvailable || Boolean(state.user);
		resetOpenButton.hidden = isRegister || state.setupAvailable || Boolean(state.user);
		modeSwitch.textContent = isRegister ? text("auth_switch_login") : text("auth_switch_register");
		if (!dialog.open) dialog.showModal();
		if (isRegister) accountName.focus();
		else accountEmail.focus();
	}

	async function requestJson(url, body) {
		const response = await fetch(url, {
			method: body ? "POST" : "GET",
			credentials: "same-origin",
			headers: body ? { "Content-Type": "application/json" } : undefined,
			body: body ? JSON.stringify(body) : undefined,
			cache: "no-store",
		});
		const contentType = response.headers.get("content-type") || "";
		if (!contentType.toLowerCase().includes("application/json")) {
			throw new Error("Serwer nie zwrócił prawidłowej odpowiedzi API. Sprawdź konfigurację wdrożenia.");
		}
		const result = await response.json();
		if (!response.ok) throw new Error(window.siteAuthError(result.error));
		return result;
	}

	async function syncSession() {
		try {
			const result = await requestJson("/api/auth/me");
			state.user = result.user;
			state.setupAvailable = result.setupAvailable;
			renderProfile();
			const authReason = new URLSearchParams(window.location.search).get("auth");
			if (authReason) {
				setMode(state.setupAvailable ? "register" : "login");
				if (authReason === "admin" && state.user?.role !== "admin") {
					formError.textContent = text("admin_only");
					formError.hidden = false;
				}
				clearAuthQuery();
			}
		} catch {
			profileLabel.textContent = text("profile");
			profileName.textContent = text("no_connection");
			profileRole.textContent = text("refresh_retry");
		}
	}

	profileTrigger.addEventListener("click", () => {
		const willOpen = profileMenu.hidden;
		profileMenu.hidden = !willOpen;
		profileTrigger.setAttribute("aria-expanded", String(willOpen));
	});
	document.addEventListener("click", (event) => {
		if (!profileMenu.contains(event.target) && !profileTrigger.contains(event.target)) closeMenu();
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") closeMenu();
	});
	loginAction.addEventListener("click", () => {
		closeMenu();
		setMode("login");
	});
	registerAction.addEventListener("click", () => {
		closeMenu();
		setMode("register");
	});
	messagesOpen.addEventListener("click", closeMenu);
	logoutAction.addEventListener("click", async () => {
		try {
			await requestJson("/api/auth/logout", {});
			state.user = null;
			closeMenu();
			renderProfile();
		} catch (error) {
			closeMenu();
			setMode("login");
			formError.textContent = window.siteAuthError(error.message);
			formError.hidden = false;
		}
	});
	document.querySelector("#dialog-close").addEventListener("click", () => dialog.close());
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) dialog.close();
	});
	modeSwitch.addEventListener("click", () => setMode(state.mode === "register" ? "login" : "register"));
	resetOpenButton.addEventListener("click", () => {
		resetEmail.value = accountEmail.value.trim();
		resetRequestStatus.hidden = true;
		resetRequestStatus.textContent = "";
		resetConfirmStatus.hidden = true;
		resetConfirmStatus.textContent = "";
		resetRequestForm.hidden = false;
		resetConfirmForm.hidden = true;
		resetCode.value = "";
		resetPassword.value = "";
		dialog.close();
		resetDialog.showModal();
		resetEmail.focus();
	});
	document.querySelector("#password-reset-close").addEventListener("click", () => resetDialog.close());
	document.querySelector("#password-reset-back").addEventListener("click", () => {
		resetDialog.close();
		setMode("login");
	});
	resetDialog.addEventListener("click", (event) => {
		if (event.target === resetDialog) resetDialog.close();
	});
	async function sendPasswordResetCode() {
		resetSendButton.disabled = true;
		resetRequestStatus.hidden = true;
		resetRequestStatus.textContent = "";
		try {
			const result = await requestJson("/api/auth/password-reset/request", { email: resetEmail.value.trim() });
			resetRequestStatus.textContent = text("password_reset_sent");
			resetRequestStatus.hidden = false;
			resetRequestForm.hidden = true;
			resetConfirmForm.hidden = false;
			resetCode.focus();
		} catch (error) {
			resetRequestStatus.textContent = window.siteAuthError(error.message);
			resetRequestStatus.hidden = false;
		} finally {
			resetSendButton.disabled = false;
		}
	}
	resetRequestForm.addEventListener("submit", (event) => {
		event.preventDefault();
		void sendPasswordResetCode();
	});
	document.querySelector("#password-reset-resend").addEventListener("click", () => {
		resetRequestForm.hidden = false;
		void sendPasswordResetCode();
	});
	resetConfirmForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		resetConfirmButton.disabled = true;
		resetConfirmStatus.hidden = true;
		try {
			await requestJson("/api/auth/password-reset/confirm", {
				email: resetEmail.value.trim(),
				code: resetCode.value.trim(),
				password: resetPassword.value,
			});
			resetConfirmStatus.textContent = text("password_reset_success");
			resetConfirmStatus.hidden = false;
			resetConfirmForm.hidden = true;
			resetRequestForm.hidden = true;
			resetPassword.value = "";
		} catch (error) {
			resetConfirmStatus.textContent = window.siteAuthError(error.message);
			resetConfirmStatus.hidden = false;
		} finally {
			resetConfirmButton.disabled = false;
		}
	});
	document.addEventListener("languagechange", () => {
		renderProfile();
		if (dialog.open) setMode(state.mode);
	});
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		formError.hidden = true;
		submitButton.disabled = true;
		const isRegister = state.mode === "register";
		const body = {
			email: accountEmail.value.trim(),
			password: accountPassword.value,
		};
		if (isRegister) body.name = accountName.value.trim();
		try {
			const result = await requestJson(isRegister ? "/api/auth/register" : "/api/auth/login", body);
			state.user = result.user;
			state.setupAvailable = result.setupAvailable;
			renderProfile();
			form.reset();
			dialog.close();
			if (isRegister && state.user?.role === "admin") {
				profileMenu.hidden = false;
				profileTrigger.setAttribute("aria-expanded", "true");
			}
			clearAuthQuery();
		} catch (error) {
			formError.textContent = window.siteAuthError(error.message);
			formError.hidden = false;
		} finally {
			submitButton.disabled = false;
		}
	});

	syncSession();
})();