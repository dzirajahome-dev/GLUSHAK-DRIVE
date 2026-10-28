const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const expectedAdminId = (process.env.SUPABASE_AUTH_ADMIN_ID || "").toLowerCase();
const accountsFile = path.join(__dirname, "..", "users.json");
const workspace = path.resolve(__dirname, "..");

if (!supabaseUrl || !serviceRoleKey) {
	throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before migrating accounts.");
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
	throw new Error("SUPABASE_URL must be an HTTPS Supabase project URL.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (process.env.SUPABASE_CONFIRM_PROJECT_REF !== projectRef) {
	throw new Error("Set SUPABASE_CONFIRM_PROJECT_REF to the exact project ref in SUPABASE_URL before migrating.");
}
if (process.env.SUPABASE_BACKUP_CONFIRMED !== "YES") {
	throw new Error("Migration is paused. Set SUPABASE_BACKUP_CONFIRMED=YES only after verifying the backup and selected project.");
}
if (process.env.SUPABASE_AUTH_SOURCE_CONFIRMED !== "YES") {
	throw new Error("Migration is paused. Confirm that users.json is the authoritative account source before migrating.");
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(expectedAdminId)) {
	throw new Error("Set SUPABASE_AUTH_ADMIN_ID to the privately verified ID of the existing administrator.");
}
const backupFile = process.env.SUPABASE_AUTH_BACKUP_FILE;
if (!backupFile || !fs.existsSync(backupFile) || fs.statSync(backupFile).size === 0) {
	throw new Error("Create and verify a non-empty database backup, then set SUPABASE_AUTH_BACKUP_FILE before migrating.");
}
if (!path.isAbsolute(backupFile) || backupFile.toLowerCase().startsWith(`${workspace}${path.sep}`.toLowerCase())) {
	throw new Error("Store the verified database backup outside the repository and provide its absolute path.");
}
const backupMetadataFile = `${backupFile}.metadata.json`;
if (!fs.existsSync(backupMetadataFile)) throw new Error("The database backup metadata file is missing.");
const backupMetadata = JSON.parse(fs.readFileSync(backupMetadataFile, "utf8"));
if (backupMetadata.projectRef !== projectRef || backupMetadata.size !== fs.statSync(backupFile).size
	|| !/^[a-f0-9]{64}$/i.test(backupMetadata.sha256 || "")) {
	throw new Error("The verified backup does not match the selected Supabase project.");
}

function loadUsers() {
	const stored = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
	if (!Array.isArray(stored.users)) throw new Error("users.json must contain a users array.");
	return stored.users;
}

function toDatabaseUser(user) {
	if (!user || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id || "")
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
		password_salt: user.salt.toLowerCase(),
		password_hash: user.passwordHash.toLowerCase(),
		created_at: user.createdAt && !Number.isNaN(Date.parse(user.createdAt))
			? new Date(user.createdAt).toISOString()
			: new Date().toISOString(),
	};
}

async function migrate() {
	const hash = crypto.createHash("sha256");
	for await (const chunk of fs.createReadStream(backupFile)) hash.update(chunk);
	if (hash.digest("hex") !== backupMetadata.sha256) {
		throw new Error("The database backup changed after verification; account migration is blocked.");
	}
	const users = loadUsers().map(toDatabaseUser);
	const admins = users.filter((user) => user.role === "admin");
	if (admins.length !== 1 || admins[0].id.toLowerCase() !== expectedAdminId) {
		throw new Error("The source must contain exactly one administrator matching SUPABASE_AUTH_ADMIN_ID; no accounts were migrated.");
	}
	if (new Set(users.map((user) => user.id.toLowerCase())).size !== users.length
		|| new Set(users.map((user) => user.email)).size !== users.length) {
		throw new Error("The account source contains duplicate IDs or emails; no accounts were migrated.");
	}
	if (!users.length) {
		console.log("No accounts found in users.json; nothing to migrate.");
		return;
	}
	const pendingUsers = [];
	for (const user of users) {
		const existingById = await fetch(
			`${supabaseUrl}/rest/v1/site_users?select=id,email,role,password_salt,password_hash&id=eq.${encodeURIComponent(user.id)}&limit=1`,
			{ headers: { apikey: serviceRoleKey, Authorization: `******` } },
		);
		if (!existingById.ok) throw new Error(`Could not check existing accounts (HTTP ${existingById.status}).`);
		const idMatches = await existingById.json();
		if (idMatches.length) {
			const existing = idMatches[0];
			if (existing.email !== user.email || existing.role !== user.role
				|| existing.password_salt !== user.password_salt || existing.password_hash !== user.password_hash) {
				throw new Error("An existing account has conflicting identity, role, or credentials. No accounts were migrated.");
			}
			continue;
		}
		const existingByEmail = await fetch(
			`${supabaseUrl}/rest/v1/site_users?select=id,email,role&email=eq.${encodeURIComponent(user.email)}&limit=1`,
			{ headers: { apikey: serviceRoleKey, Authorization: `******` } },
		);
		if (!existingByEmail.ok) throw new Error(`Could not check existing account emails (HTTP ${existingByEmail.status}).`);
		const emailMatches = await existingByEmail.json();
		if (emailMatches.length) {
			throw new Error("An existing account uses an email assigned to a different ID. No accounts were migrated.");
		}
		pendingUsers.push(user);
	}
	if (!pendingUsers.length) {
		console.log(`All ${users.length} account(s) already exist with matching roles; no rows changed.`);
		return;
	}
	const response = await fetch(`${supabaseUrl}/rest/v1/site_users?on_conflict=id`, {
		method: "POST",
		headers: {
			apikey: serviceRoleKey,
			Authorization: `******`,
			"Content-Type": "application/json",
			Prefer: "resolution=ignore-duplicates,return=minimal",
		},
		body: JSON.stringify(pendingUsers),
	});
	if (!response.ok) {
		throw new Error(`Supabase account migration failed with HTTP ${response.status}.`);
	}
	console.log(`Added ${pendingUsers.length} missing account(s), retaining existing IDs and roles.`);
	console.log("Existing sessions were not migrated; users must sign in again.");
}

migrate().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
