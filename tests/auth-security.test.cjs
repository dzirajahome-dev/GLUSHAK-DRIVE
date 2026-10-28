const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const handler = require("../api/auth/[...path].js");
const originalFetch = global.fetch;
const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const middlewarePromise = import("../middleware.js");

function response(status, value) {
	return new Response(value === null ? "" : JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

async function invoke(pathname, body, fetchMock, headers = {}) {
	global.fetch = fetchMock;
	const outputHeaders = {};
	const output = {
		headersSent: false,
		setHeader(name, value) { outputHeaders[name.toLowerCase()] = value; },
		end(value) { this.body = value; this.headersSent = true; },
	};
	await handler({
		url: pathname,
		method: body ? "POST" : "GET",
		headers: { host: "glushakdriive.vercel.app", ...headers },
		body,
	}, output);
	return { status: output.statusCode, headers: outputHeaders, body: JSON.parse(output.body) };
}

test.after(() => {
	global.fetch = originalFetch;
	if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
	else process.env.SUPABASE_URL = originalSupabaseUrl;
	if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
	else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
});

test("public registration creates a regular user even when no administrator exists", async () => {
	process.env.SUPABASE_URL = "https://unit-test.supabase.co";
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
	const createdUser = {
		id: "11111111-1111-4111-8111-111111111111",
		name: "New User",
		email: "new@example.com",
		role: "user",
	};
	let userCreateCalls = 0;
	const result = await invoke("/api/auth/register", {
		name: "New User",
		email: "new@example.com",
		password: "a-strong-test-password",
		role: "admin",
	}, async (url, options) => {
		if (String(url).includes("consume_site_auth_rate_limit")) return response(200, true);
		if (String(url).includes("rpc/create_site_user")) {
			userCreateCalls += 1;
			const payload = JSON.parse(options.body);
			assert.equal("role" in payload, false);
			return response(200, createdUser);
		}
		if (String(url).includes("site_sessions")) return response(201, null);
		throw new Error("Unexpected mocked Supabase request.");
	});

	assert.equal(userCreateCalls, 1);
	assert.equal(result.status, 201);
	assert.equal(result.body.user.role, "user");
	assert.equal(result.body.created.role, "user");
	assert.match(result.headers["set-cookie"], /HttpOnly/);
});

test("login creates a hashed session token and /me resolves that session", async () => {
	process.env.SUPABASE_URL = "https://unit-test.supabase.co";
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
	const salt = "0123456789abcdef0123456789abcdef";
	const password = "an-existing-admin-password";
	const admin = {
		id: "22222222-2222-4222-8222-222222222222",
		name: "Existing Admin",
		email: "admin@example.com",
		role: "admin",
		password_salt: salt,
		password_hash: crypto.scryptSync(password, salt, 64).toString("hex"),
	};
	let storedSession;
	const login = await invoke("/api/auth/login", {
		email: admin.email,
		password,
	}, async (url, options) => {
		if (String(url).includes("consume_site_auth_rate_limit")) return response(200, true);
		if (String(url).includes("site_users?")) return response(200, [admin]);
		if (String(url).includes("site_sessions") && options.method === "POST") {
			storedSession = JSON.parse(options.body);
			return response(201, null);
		}
		throw new Error("Unexpected mocked Supabase request.");
	});

	const cookie = login.headers["set-cookie"].match(/glushak_session=([^;]+)/);
	assert.ok(cookie);
	const token = decodeURIComponent(cookie[1]);
	assert.equal(storedSession.token_hash, crypto.createHash("sha256").update(token).digest("hex"));
	assert.notEqual(storedSession.token_hash, token);

	const session = await invoke("/api/auth/me", null, async (url) => {
		if (String(url).includes("site_sessions?")) return response(200, [{ user_id: admin.id }]);
		if (String(url).includes("site_users?")) return response(200, [{
			id: admin.id,
			name: admin.name,
			email: admin.email,
			role: admin.role,
		}]);
		throw new Error("Unexpected mocked Supabase request.");
	}, { cookie: `glushak_session=${encodeURIComponent(token)}` });

	assert.equal(session.status, 200);
	assert.equal(session.body.user.role, "admin");
});

test("logout deletes only the current hashed session", async () => {
	process.env.SUPABASE_URL = "https://unit-test.supabase.co";
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
	const token = "synthetic-session-token";
	const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
	let deletedSessionHash;
	const result = await invoke("/api/auth/logout", {}, async (url, options) => {
		if (String(url).includes("consume_site_auth_rate_limit")) return response(200, true);
		if (String(url).includes("site_sessions") && options.method === "DELETE") {
			deletedSessionHash = new URL(String(url)).searchParams.get("token_hash");
			return response(200, null);
		}
		throw new Error("Unexpected mocked Supabase request.");
	}, { cookie: `glushak_session=${encodeURIComponent(token)}` });

	assert.equal(result.status, 200);
	assert.equal(result.body.ok, true);
	assert.equal(deletedSessionHash, `eq.${tokenHash}`);
	assert.match(result.headers["set-cookie"], /Max-Age=0/);
});

test("an existing administrator can still sign in with administrator permissions", async () => {
	process.env.SUPABASE_URL = "https://unit-test.supabase.co";
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
	const salt = "0123456789abcdef0123456789abcdef";
	const password = "an-existing-admin-password";
	const admin = {
		id: "22222222-2222-4222-8222-222222222222",
		name: "Existing Admin",
		email: "admin@example.com",
		role: "admin",
		password_salt: salt,
		password_hash: crypto.scryptSync(password, salt, 64).toString("hex"),
	};
	const result = await invoke("/api/auth/login", {
		email: admin.email,
		password,
	}, async (url) => {
		if (String(url).includes("consume_site_auth_rate_limit")) return response(200, true);
		if (String(url).includes("site_users?")) return response(200, [admin]);
		if (String(url).includes("site_sessions")) return response(201, null);
		throw new Error("Unexpected mocked Supabase request.");
	});

	assert.equal(result.status, 200);
	assert.equal(result.body.user.role, "admin");
	assert.equal("password_hash" in result.body.user, false);
});

test("an ordinary user can sign in without receiving administrator permissions", async () => {
	process.env.SUPABASE_URL = "https://unit-test.supabase.co";
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
	const salt = "abcdef0123456789abcdef0123456789";
	const password = "a-regular-user-password";
	const user = {
		id: "33333333-3333-4333-8333-333333333333",
		name: "Regular User",
		email: "user@example.com",
		role: "user",
		password_salt: salt,
		password_hash: crypto.scryptSync(password, salt, 64).toString("hex"),
	};
	const result = await invoke("/api/auth/login", {
		email: user.email,
		password,
	}, async (url) => {
		if (String(url).includes("consume_site_auth_rate_limit")) return response(200, true);
		if (String(url).includes("site_users?")) return response(200, [user]);
		if (String(url).includes("site_sessions")) return response(201, null);
		throw new Error("Unexpected mocked Supabase request.");
	});

	assert.equal(result.status, 200);
	assert.equal(result.body.user.role, "user");
});

test("password reset hashes codes with the server-only key", async () => {
	process.env.SUPABASE_URL = "https://unit-test.supabase.co";
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
	const salt = "0123456789abcdef0123456789abcdef";
	const code = "123456";
	let rpcCalled = false;
	const result = await invoke("/api/auth/password-reset/confirm", {
		email: "user@example.com",
		code,
		password: "a-new-strong-password",
	}, async (url, options) => {
		if (String(url).includes("consume_site_auth_rate_limit")) return response(200, true);
		if (String(url).includes("site_password_reset_codes?")) return response(200, [{ salt }]);
		if (String(url).includes("rpc/consume_site_password_reset")) {
			rpcCalled = true;
			const payload = JSON.parse(options.body);
			const expected = crypto.createHmac("sha256", "test-only-key").update(`${salt}:${code}`).digest("hex");
			assert.equal(payload.p_code_hash, expected);
			return response(200, true);
		}
		throw new Error("Unexpected mocked Supabase request.");
	});

	assert.equal(rpcCalled, true);
	assert.equal(result.status, 200);
});

test("SQL and local registration cannot assign admin through public registration", () => {
	const schema = fs.readFileSync(path.join(root, "supabase", "auth-schema.sql"), "utf8");
	const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
	const api = fs.readFileSync(path.join(root, "api", "auth", "[...path].js"), "utf8");
	assert.match(schema, /values\s*\(p_id,\s*btrim\(p_name\),\s*lower\(btrim\(p_email\)\),\s*'user'/i);
	assert.match(server, /role:\s*"user"/);
	assert.doesNotMatch(api, /AUTH_ALLOW_FIRST_ADMIN_SETUP/);
	assert.match(api, /createHmac\("sha256", config\.key\)/);
	assert.match(server, /createHmac\("sha256", passwordResetPepper\)/);
	assert.doesNotMatch(schema, /when\s+not\s+exists\s*\(select\s+1\s+from\s+public\.site_users\s+where\s+role\s*=\s*'admin'\)/i);
	assert.match(schema, /revoke all on function public\.promote_site_user_to_admin\(text\) from public, anon, authenticated/i);
	assert.match(schema, /grant execute on function public\.promote_site_user_to_admin\(text\) to service_role/i);
});

test("the Studio middleware allows only sessions whose server-side account role is admin", async () => {
	process.env.SUPABASE_URL = "https://unit-test.supabase.co";
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
	const { middleware } = await middlewarePromise;
	const originalFetchForTest = global.fetch;
	const token = "synthetic-session-token";
	const digest = crypto.createHash("sha256").update(token).digest("hex");
	try {
		global.fetch = async (url) => {
			if (String(url).includes("site_sessions?")) {
				assert.ok(String(url).includes(encodeURIComponent(digest)));
				return response(200, [{ user_id: "44444444-4444-4444-8444-444444444444" }]);
			}
			if (String(url).includes("site_users?")) return response(200, [{ role: "admin" }]);
			throw new Error("Unexpected mocked authorization request.");
		};
		const allowed = await middleware(new Request("https://example.test/studio", {
			headers: { cookie: `glushak_session=${token}` },
		}));
		assert.equal(allowed, undefined);

		global.fetch = async (url) => {
			if (String(url).includes("site_sessions?")) {
				return response(200, [{ user_id: "55555555-5555-4555-8555-555555555555" }]);
			}
			if (String(url).includes("site_users?")) return response(200, [{ role: "user" }]);
			throw new Error("Unexpected mocked authorization request.");
		};
		const denied = await middleware(new Request("https://example.test/studio", {
			headers: { cookie: `glushak_session=${token}` },
		}));
		assert.equal(denied.status, 302);
		assert.match(denied.headers.get("location"), /auth=admin/);
	} finally {
		global.fetch = originalFetchForTest;
	}
});
