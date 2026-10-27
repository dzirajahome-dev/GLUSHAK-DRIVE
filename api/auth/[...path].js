const crypto = require("node:crypto");

const sessionCookie = "glushak_session";
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const dummySalt = "2f09c9e1243768ab3d8075f61a4bce90";
const dummyPasswordHash = crypto.scryptSync("not-a-real-account-password", dummySalt, 64).toString("hex");

function sendJson(response, status, value) {
	response.statusCode = status;
	response.setHeader("Content-Type", "application/json; charset=utf-8");
	response.setHeader("Cache-Control", "no-store");
	response.setHeader("X-Content-Type-Options", "nosniff");
	response.end(JSON.stringify(value));
}

function cookieValue(request, name) {
	const prefix = `${name}=`;
	const item = (request.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
	if (!item) return "";
	try {
		return decodeURIComponent(item.slice(prefix.length));
	} catch {
		return "";
	}
}

function isSameOrigin(request) {
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	const origin = request.headers.origin;
	if (typeof origin !== "string" || origin.length === 0) return true;
	try {
		const parsed = new URL(origin);
		if (!["http:", "https:"].includes(parsed.protocol)
			|| parsed.host.toLowerCase() !== host.toLowerCase()
			|| parsed.username || parsed.password) return false;
	} catch {
		return false;
	}
	const fetchSite = request.headers["sec-fetch-site"];
	return fetchSite === undefined || fetchSite === "same-origin";
}

function getSupabaseConfig() {
	const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
	if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !key) return null;
	return { url, key };
}

async function supabaseRequest(config, route, options = {}) {
	const response = await fetch(`${config.url}/rest/v1/${route}`, {
		...options,
		headers: {
			apikey: config.key,
			Authorization: `Bearer ${config.key}`,
			"Content-Type": "application/json",
			...(options.headers || {}),
		},
	});
	const text = await response.text();
	let result;
	try {
		result = text ? JSON.parse(text) : null;
	} catch {
		throw new Error(`Supabase returned a non-JSON response (HTTP ${response.status}).`);
	}
	if (!response.ok) {
		throw new Error(`Supabase request failed (HTTP ${response.status}).`);
	}
	return result;
}

async function readBody(request) {
	if (request.body !== undefined) {
		const parsed = request.body;
		if (typeof parsed === "string") {
			if (Buffer.byteLength(parsed) > 8192) {
				const error = new Error("Żądanie jest za duże.");
				error.status = 413;
				throw error;
			}
			try {
				return JSON.parse(parsed);
			} catch {
				const error = new Error("Nieprawidłowe dane żądania.");
				error.status = 400;
				throw error;
			}
		}
		if (Buffer.byteLength(JSON.stringify(parsed)) > 8192) {
			const error = new Error("Żądanie jest za duże.");
			error.status = 413;
			throw error;
		}
		return parsed;
	}

	let raw = "";
	for await (const chunk of request) {
		raw += chunk;
		if (raw.length > 8192) {
			const error = new Error("Żądanie jest za duże.");
			error.status = 413;
			throw error;
		}
	}
	try {
		return JSON.parse(raw);
	} catch {
		const error = new Error("Nieprawidłowe dane żądania.");
		error.status = 400;
		throw error;
	}
}

function publicUser(user) {
	return user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null;
}

function passwordMatches(password, user) {
	const salt = user?.password_salt || dummySalt;
	const expectedHex = user?.password_hash || dummyPasswordHash;
	const candidate = Buffer.from(crypto.scryptSync(password, salt, 64).toString("hex"), "hex");
	const expected = Buffer.from(expectedHex, "hex");
	return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function setSessionCookie(response, token, maxAge = sessionLifetimeSeconds) {
	response.setHeader("Set-Cookie", `${sessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}; Secure`);
}

function hashToken(token) {
	return crypto.createHash("sha256").update(token).digest("hex");
}

function clientAddress(request) {
	const address = request.headers["x-real-ip"] || request.headers["x-forwarded-for"] || "unknown";
	return String(address).split(",")[0].trim().slice(0, 128) || "unknown";
}

async function isRateLimited(config, request, pathname) {
	const addressHash = crypto.createHash("sha256").update(clientAddress(request)).digest("hex");
	const policies = [{ maximum: 60, window: 60 }];
	if (pathname === "/api/auth/login") policies.push({ maximum: 10, window: 900 });
	if (pathname === "/api/auth/register") policies.push({ maximum: 8, window: 3600 });
	for (const policy of policies) {
		const result = await supabaseRequest(config, "rpc/consume_site_auth_rate_limit", {
			method: "POST",
			body: JSON.stringify({
				p_key: `${addressHash}:${pathname}:${policy.window}`,
				p_maximum: policy.maximum,
				p_window_seconds: policy.window,
			}),
		});
		if (result !== true) return true;
	}
	return false;
}

async function handle(request, response, pathname) {
	if (!["GET", "POST"].includes(request.method)) {
		response.setHeader("Allow", "GET, POST");
		sendJson(response, 405, { error: "Method not allowed" });
		return;
	}
	if (!isSameOrigin(request)) {
		sendJson(response, 403, { error: "Żądanie spoza tej strony zostało zablokowane." });
		return;
	}

	const config = getSupabaseConfig();
	if (!config) {
		sendJson(response, 503, { error: "Logowanie nie jest skonfigurowane. Skontaktuj się z administratorem." });
		return;
	}
	if (request.method === "POST" && await isRateLimited(config, request, pathname)) {
		sendJson(response, 429, { error: "Za dużo żądań. Spróbuj ponownie za chwilę." });
		return;
	}

	if (pathname === "/api/auth/me" && request.method === "GET") {
		const admins = await supabaseRequest(config, "site_users?select=id&role=eq.admin&limit=1");
		const setupAvailable = admins.length === 0;
		const token = cookieValue(request, sessionCookie);
		if (!token) {
			sendJson(response, 200, { user: null, setupAvailable });
			return;
		}
		const tokenHash = hashToken(token);
		const sessions = await supabaseRequest(
			config,
			`site_sessions?select=user_id&token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
		);
		if (!sessions.length) {
			sendJson(response, 200, { user: null, setupAvailable });
			return;
		}
		const users = await supabaseRequest(
			config,
			`site_users?select=id,name,email,role&id=eq.${encodeURIComponent(sessions[0].user_id)}&limit=1`,
		);
		sendJson(response, 200, { user: publicUser(users[0]), setupAvailable });
		return;
	}

	if (!["/api/auth/login", "/api/auth/register", "/api/auth/logout"].includes(pathname)) {
		sendJson(response, 404, { error: "Nie znaleziono endpointu API." });
		return;
	}
	if (request.method !== "POST") {
		response.setHeader("Allow", "POST");
		sendJson(response, 405, { error: "Method not allowed" });
		return;
	}

	const body = await readBody(request);
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		sendJson(response, 400, { error: "Nieprawidłowe dane żądania." });
		return;
	}

	if (pathname === "/api/auth/logout") {
		const token = cookieValue(request, sessionCookie);
		if (token) {
			await supabaseRequest(config, `site_sessions?token_hash=eq.${encodeURIComponent(hashToken(token))}`, {
				method: "DELETE",
			});
		}
		setSessionCookie(response, "", 0);
		sendJson(response, 200, { ok: true });
		return;
	}

	const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	const password = typeof body.password === "string" ? body.password : "";
	if (pathname === "/api/auth/login") {
		const users = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
			? await supabaseRequest(
				config,
				`site_users?select=id,name,email,role,password_salt,password_hash&email=eq.${encodeURIComponent(email)}&limit=1`,
			)
			: [];
		const user = users[0];
		const passwordValid = passwordMatches(password.slice(0, 256), user);
		if (!user || password.length > 256 || !passwordValid) {
			sendJson(response, 401, { error: "Nieprawidłowy e-mail lub hasło." });
			return;
		}
		const token = crypto.randomBytes(32).toString("hex");
		await supabaseRequest(config, "site_sessions", {
			method: "POST",
			headers: { Prefer: "return=minimal" },
			body: JSON.stringify({
				token_hash: hashToken(token),
				user_id: user.id,
				expires_at: new Date(Date.now() + sessionLifetimeSeconds * 1000).toISOString(),
			}),
		});
		setSessionCookie(response, token);
		sendJson(response, 200, { user: publicUser(user), setupAvailable: false });
		return;
	}

	const name = typeof body.name === "string" ? body.name.trim() : "";
	if (name.length < 2 || name.length > 50
		|| !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
		|| password.length < 10 || password.length > 256) {
		sendJson(response, 400, { error: "Wpisz nazwę, prawidłowy e-mail i hasło (co najmniej 10 znaków)." });
		return;
	}
	const salt = crypto.randomBytes(16).toString("hex");
	const created = await supabaseRequest(config, "rpc/create_site_user", {
		method: "POST",
		body: JSON.stringify({
			p_id: crypto.randomUUID(),
			p_name: name,
			p_email: email,
			p_salt: salt,
			p_password_hash: crypto.scryptSync(password, salt, 64).toString("hex"),
		}),
	});
	if (!created || !created.id) {
		sendJson(response, 409, { error: "Konto z tym adresem e-mail już istnieje." });
		return;
	}
	const token = crypto.randomBytes(32).toString("hex");
	await supabaseRequest(config, "site_sessions", {
		method: "POST",
		headers: { Prefer: "return=minimal" },
		body: JSON.stringify({
			token_hash: hashToken(token),
			user_id: created.id,
			expires_at: new Date(Date.now() + sessionLifetimeSeconds * 1000).toISOString(),
		}),
	});
	setSessionCookie(response, token);
	sendJson(response, 201, {
		user: publicUser(created),
		created: publicUser(created),
		setupAvailable: false,
	});
}

module.exports = async function handler(request, response) {
	response.setHeader("X-Content-Type-Options", "nosniff");
	response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
	const path = new URL(request.url, "https://vercel.invalid").pathname;
	try {
		await handle(request, response, path);
	} catch (error) {
		console.error("Production authentication request failed.", error);
		if (!response.headersSent) {
			sendJson(response, 503, { error: "Usługa logowania jest chwilowo niedostępna." });
		} else {
			response.end();
		}
	}
};
