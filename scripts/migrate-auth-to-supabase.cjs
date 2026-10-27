const fs = require("node:fs");
const path = require("node:path");

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const accountsFile = path.join(__dirname, "..", "users.json");

if (!supabaseUrl || !serviceRoleKey) {
	throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before migrating accounts.");
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
	throw new Error("SUPABASE_URL must be an HTTPS Supabase project URL.");
}

function loadUsers() {
	const stored = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
	if (!Array.isArray(stored.users)) throw new Error("users.json must contain a users array.");
	return stored.users;
}

function toDatabaseUser(user) {
	if (!user || !/^[a-f0-9-]{36}$/i.test(user.id || "")
		|| typeof user.name !== "string" || user.name.trim().length < 2 || user.name.trim().length > 50
		|| typeof user.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)
		|| !["user", "admin"].includes(user.role)
		|| !/^[a-f0-9]{32}$/i.test(user.salt || "")
		|| !/^[a-f0-9]{128}$/i.test(user.passwordHash || "")) {
		throw new Error("users.json contains an invalid account record.");
	}
	return {
		id: user.id,
		name: user.name.trim(),
		email: user.email.trim().toLowerCase(),
		role: user.role,
		password_salt: user.salt,
		password_hash: user.passwordHash,
		created_at: user.createdAt && !Number.isNaN(Date.parse(user.createdAt))
			? new Date(user.createdAt).toISOString()
			: new Date().toISOString(),
	};
}

async function migrate() {
	const users = loadUsers().map(toDatabaseUser);
	if (users.filter((user) => user.role === "admin").length > 1) {
		throw new Error("users.json contains more than one administrator; resolve this before migration.");
	}
	if (!users.length) {
		console.log("No accounts found in users.json; nothing to migrate.");
		return;
	}
	const response = await fetch(`${supabaseUrl}/rest/v1/site_users?on_conflict=id`, {
		method: "POST",
		headers: {
			apikey: serviceRoleKey,
			Authorization: `******`,
			"Content-Type": "application/json",
			Prefer: "resolution=merge-duplicates,return=minimal",
		},
		body: JSON.stringify(users),
	});
	if (!response.ok) {
		throw new Error(`Supabase account migration failed with HTTP ${response.status}.`);
	}
	console.log(`Migrated ${users.length} account(s), retaining existing IDs and roles.`);
	console.log("Existing sessions were not migrated; users must sign in again.");
}

migrate().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
