const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const expectedAdminId = (process.env.SUPABASE_AUTH_ADMIN_ID || "").toLowerCase();
const expectedProjectRef = "idhbthrrgcdgogjhosjw";
const args = process.argv.slice(2);
const allowedArgs = new Set(["--dry-run", "--apply"]);
const dryRun = args.includes("--dry-run");
const apply = args.includes("--apply");
const accountsFile = path.join(__dirname, "..", "users.json");
const workspace = path.resolve(__dirname, "..");

if (args.some((arg) => !allowedArgs.has(arg)) || (dryRun && apply) || args.length > 1) {
	throw new Error("Choose exactly one supported mode: --dry-run or --apply.");
}
if (!args.length) {
	throw new Error("Choose --dry-run to inspect migration or --apply to write the administrator account.");
}
if (!supabaseUrl || !serviceRoleKey) {
	throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before checking the administrator migration.");
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
	throw new Error("SUPABASE_URL must be an HTTPS Supabase project URL.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== expectedProjectRef) {
	throw new Error("SUPABASE_URL does not match the approved Supabase project.");
}
if (process.env.SUPABASE_CONFIRM_PROJECT_REF !== projectRef) {
	throw new Error("Set SUPABASE_CONFIRM_PROJECT_REF to the approved project ref before checking the migration.");
}
if (process.env.SUPABASE_BACKUP_CONFIRMED !== "YES") {
	throw new Error("Migration is paused. Confirm the backup and selected project before continuing.");
}
if (process.env.SUPABASE_AUTH_SOURCE_CONFIRMED !== "YES") {
	throw new Error("Migration is paused. Confirm users.json as the authoritative account source before continuing.");
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
const backupMetadataContents = fs.readFileSync(backupMetadataFile, "utf8").replace(/^\uFEFF/, "");
const backupMetadata = JSON.parse(backupMetadataContents);
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
		|| typeof user.name !== "string" || user.name !== user.name.trim()
		|| user.name.length < 2 || user.name.length > 50
		|| typeof user.email !== "string" || user.email.length > 254
		|| user.email !== user.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)
		|| user.role !== "admin"
		|| !/^[a-f0-9]{32}$/.test(user.salt || "")
		|| !/^[a-f0-9]{128}$/.test(user.passwordHash || "")) {
		throw new Error("users.json contains an invalid account record.");
	}
	return {
		id: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
		password_salt: user.salt,
		password_hash: user.passwordHash,
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
	const sourceUsers = loadUsers();
	const admins = sourceUsers.filter((user) => user && user.role === "admin");
	if (admins.length !== 1) {
		throw new Error("The source must contain exactly one administrator matching SUPABASE_AUTH_ADMIN_ID; no data was written.");
	}
	const admin = toDatabaseUser(admins[0]);
	if (admin.id.toLowerCase() !== expectedAdminId) {
		throw new Error("The source must contain exactly one administrator matching SUPABASE_AUTH_ADMIN_ID; no data was written.");
	}
	const requestHeaders = {
		apikey: serviceRoleKey,
		Authorization: `Bearer ${serviceRoleKey}`,
	};
	const existingById = await fetch(
			`${supabaseUrl}/rest/v1/site_users?select=id,name,email,role,password_salt,password_hash&id=eq.${encodeURIComponent(admin.id)}&limit=1`,
			{ headers: requestHeaders },
		);
	if (!existingById.ok) throw new Error(`Could not check the administrator ID (HTTP ${existingById.status}).`);
	const idMatches = await existingById.json();
	if (idMatches.length) {
		const existing = idMatches[0];
		if (existing.name !== admin.name || existing.email !== admin.email || existing.role !== admin.role
			|| existing.password_salt !== admin.password_salt || existing.password_hash !== admin.password_hash) {
			throw new Error("The administrator ID already exists with conflicting data. No data was written.");
		}
		console.log("The matching administrator already exists; no data was written.");
		return;
	}

	const existingByEmail = await fetch(
		`${supabaseUrl}/rest/v1/site_users?select=id,email&email=ilike.${encodeURIComponent(admin.email)}&limit=1`,
		{ headers: requestHeaders },
	);
	if (!existingByEmail.ok) throw new Error(`Could not check the administrator email (HTTP ${existingByEmail.status}).`);
	const emailMatches = await existingByEmail.json();
	if (emailMatches.length) {
		throw new Error("The administrator email is already assigned to a different account. No data was written.");
	}

	if (dryRun) {
		console.log("Dry run passed: one existing administrator is valid, the approved project and backup match, and no ID/email conflicts were found. No data was written.");
		return;
	}

	const response = await fetch(`${supabaseUrl}/rest/v1/site_users`, {
		method: "POST",
		headers: {
			...requestHeaders,
			"Content-Type": "application/json",
			Prefer: "return=minimal",
		},
		body: JSON.stringify([admin]),
	});
	if (response.status === 409) {
		throw new Error("A conflicting account appeared during migration. No existing records were overwritten.");
	}
	if (!response.ok) {
		throw new Error(`Supabase administrator migration failed with HTTP ${response.status}.`);
	}
	console.log("Added exactly one existing administrator, retaining its original identity and credentials.");
	console.log("Existing sessions were not migrated; the administrator must sign in again.");
}

migrate().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
