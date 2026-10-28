const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const sourceScript = path.resolve(__dirname, "..", "scripts", "migrate-auth-to-supabase.cjs");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glushak-auth-migration-test-"));
const mockStateFile = path.join(fixtureRoot, "mock-database.json");
const fetchMockFile = path.join(fixtureRoot, "mock-fetch.cjs");
const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

fs.writeFileSync(fetchMockFile, `
const fs = require("node:fs");
global.fetch = async (input, options = {}) => {
	const stateFile = process.env.MOCK_SUPABASE_STATE;
	const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
	const url = new URL(String(input));
	if (options.method === "POST") {
		const incoming = JSON.parse(options.body);
		for (const row of incoming) {
			if (!state.rows.some((item) => item.id === row.id)) state.rows.push(row);
		}
		state.writeRequests += 1;
		fs.writeFileSync(stateFile, JSON.stringify(state));
		return new Response("", { status: 201 });
	}
	const id = url.searchParams.get("id");
	const email = url.searchParams.get("email");
	let rows = state.rows;
	if (id) rows = rows.filter((row) => row.id === id.replace(/^eq\\./, ""));
	if (email) rows = rows.filter((row) => row.email === email.replace(/^eq\\./, ""));
	return new Response(JSON.stringify(rows), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
};
`);

function makeUser(id, name, email, role, saltChar, hashChar) {
	const salt = saltChar.repeat(32);
	return {
		id,
		name,
		email,
		role,
		salt,
		passwordHash: crypto.scryptSync(`synthetic-${hashChar}-password`, salt, 64).toString("hex"),
		createdAt: "2025-01-02T03:04:05.000Z",
	};
}

function makeDatabaseRow(user, changes = {}) {
	return {
		id: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
		password_salt: user.salt,
		password_hash: user.passwordHash,
		created_at: user.createdAt,
		...changes,
	};
}

function runMigration(name, users, rows = [], adminIdOverride = adminId, sourceConfirmed = true) {
	const scenarioPath = path.join(fixtureRoot, name);
	fs.mkdirSync(path.join(scenarioPath, "scripts"), { recursive: true });
	fs.copyFileSync(sourceScript, path.join(scenarioPath, "scripts", "migrate-auth-to-supabase.cjs"));
	fs.writeFileSync(path.join(scenarioPath, "users.json"), JSON.stringify({ users, sessions: [] }));

	const backupPath = path.join(fixtureRoot, `${name}-synthetic-backup.dump`);
	const backupContents = "synthetic fixture only; not a database backup";
	fs.writeFileSync(backupPath, backupContents);
	fs.writeFileSync(`${backupPath}.metadata.json`, `\uFEFF${JSON.stringify({
		projectRef: "unit-test-project",
		size: Buffer.byteLength(backupContents),
		sha256: crypto.createHash("sha256").update(backupContents).digest("hex"),
	})}`);
	fs.writeFileSync(mockStateFile, JSON.stringify({ rows, writeRequests: 0 }));

	const env = {
		...process.env,
		SUPABASE_URL: "https://unit-test-project.supabase.co",
		SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-key",
		SUPABASE_CONFIRM_PROJECT_REF: "unit-test-project",
		SUPABASE_BACKUP_CONFIRMED: "YES",
		SUPABASE_AUTH_SOURCE_CONFIRMED: sourceConfirmed ? "YES" : "",
		SUPABASE_AUTH_ADMIN_ID: adminIdOverride || "",
		SUPABASE_AUTH_BACKUP_FILE: backupPath,
		MOCK_SUPABASE_STATE: mockStateFile,
	};
	const result = spawnSync(process.execPath, [
		"--require",
		fetchMockFile,
		path.join(scenarioPath, "scripts", "migrate-auth-to-supabase.cjs"),
	], { env, encoding: "utf8" });
	return {
		result,
		state: JSON.parse(fs.readFileSync(mockStateFile, "utf8")),
	};
}

test.after(() => {
	fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test("migrates the explicitly identified existing admin and regular user, preserving credentials", () => {
	const admin = makeUser(adminId, "Synthetic Admin", "admin@example.test", "admin", "a", "1");
	const user = makeUser("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Synthetic User", "user@example.test", "user", "b", "2");
	const { result, state } = runMigration("success", [admin, user]);

	assert.equal(result.status, 0, result.stderr);
	assert.equal(state.rows.length, 2);
	assert.equal(state.writeRequests, 1);
	const migratedAdmin = state.rows.find((row) => row.id === admin.id);
	assert.equal(migratedAdmin.role, "admin");
	assert.equal(migratedAdmin.password_salt, admin.salt);
	assert.equal(migratedAdmin.password_hash, admin.passwordHash);
	assert.equal(
		crypto.scryptSync("synthetic-1-password", migratedAdmin.password_salt, 64).toString("hex"),
		migratedAdmin.password_hash,
	);
	assert.equal(state.rows.find((row) => row.id === user.id).role, "user");
});

test("refuses to migrate when the expected admin identity is missing or does not match", () => {
	const admin = makeUser(adminId, "Synthetic Admin", "admin@example.test", "admin", "a", "1");

	const missingId = runMigration("missing-admin-id", [admin], [], "");
	assert.notEqual(missingId.result.status, 0);
	assert.equal(missingId.state.writeRequests, 0);

	const unconfirmedSource = runMigration("unconfirmed-source", [admin], [], adminId, false);
	assert.notEqual(unconfirmedSource.result.status, 0);
	assert.equal(unconfirmedSource.state.writeRequests, 0);

	const wrongId = runMigration("wrong-admin-id", [admin], [], "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
	assert.notEqual(wrongId.result.status, 0);
	assert.equal(wrongId.state.writeRequests, 0);

	const extraAdmin = makeUser("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Another Admin", "other@example.test", "admin", "c", "3");
	const ambiguous = runMigration("multiple-admins", [admin, extraAdmin]);
	assert.notEqual(ambiguous.result.status, 0);
	assert.equal(ambiguous.state.writeRequests, 0);
});

test("is a no-op on rerun when an existing account has matching identity, role, and credentials", () => {
	const admin = makeUser(adminId, "Synthetic Admin", "admin@example.test", "admin", "a", "1");
	const user = makeUser("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Synthetic User", "user@example.test", "user", "b", "2");
	const { result, state } = runMigration("repeat", [admin, user], [
		makeDatabaseRow(admin),
		makeDatabaseRow(user),
	]);

	assert.equal(result.status, 0, result.stderr);
	assert.equal(state.rows.length, 2);
	assert.equal(state.writeRequests, 0);
});

test("aborts before writes on ID, email, role, or credential conflicts", () => {
	const admin = makeUser(adminId, "Synthetic Admin", "admin@example.test", "admin", "a", "1");
	const sameEmailOtherId = makeUser(
		"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		"Different Account",
		admin.email,
		"user",
		"b",
		"2",
	);
	const emailConflict = runMigration("email-conflict", [admin], [makeDatabaseRow(sameEmailOtherId)]);
	assert.notEqual(emailConflict.result.status, 0);
	assert.equal(emailConflict.state.writeRequests, 0);
	assert.equal(emailConflict.state.rows[0].role, "user");

	for (const [name, changes] of [
		["role-conflict", { role: "user" }],
		["hash-conflict", { password_hash: "f".repeat(128) }],
		["salt-conflict", { password_salt: "e".repeat(32) }],
		["email-id-conflict", { email: "other@example.test" }],
	]) {
		const conflict = runMigration(name, [admin], [makeDatabaseRow(admin, changes)]);
		assert.notEqual(conflict.result.status, 0, `${name} should stop`);
		assert.equal(conflict.state.writeRequests, 0, `${name} must not write`);
	}
});
