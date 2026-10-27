const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const workspace = path.resolve(__dirname, "..");
const databaseUrl = process.env.SUPABASE_DB_URL || "";
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const pgDumpPath = process.env.PG_DUMP_PATH || "pg_dump";
const backupPath = process.env.SUPABASE_AUTH_BACKUP_FILE
	? path.resolve(process.env.SUPABASE_AUTH_BACKUP_FILE)
	: "";

if (!databaseUrl || !supabaseUrl || !backupPath) {
	throw new Error("Set SUPABASE_URL, SUPABASE_DB_URL, and an absolute SUPABASE_AUTH_BACKUP_FILE path.");
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
	throw new Error("SUPABASE_URL must be an HTTPS Supabase project URL.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (process.env.SUPABASE_CONFIRM_PROJECT_REF !== projectRef) {
	throw new Error("Set SUPABASE_CONFIRM_PROJECT_REF to the exact project ref in SUPABASE_URL before backing up.");
}
const workspacePrefix = `${workspace}${path.sep}`.toLowerCase();
if (backupPath.toLowerCase().startsWith(workspacePrefix)) {
	throw new Error("Store the database backup outside the repository.");
}
if (fs.existsSync(backupPath)) {
	throw new Error("The requested backup file already exists; choose a new path.");
}

async function backup() {
	const connection = new URL(databaseUrl);
	if (!["postgres:", "postgresql:"].includes(connection.protocol)) {
		throw new Error("SUPABASE_DB_URL must be a PostgreSQL connection URL.");
	}
	if (!connection.password || !connection.hostname || !connection.pathname.slice(1)) {
		throw new Error("SUPABASE_DB_URL must include database connection details.");
	}
	const parent = path.dirname(backupPath);
	fs.mkdirSync(parent, { recursive: true });
	const environment = {
		...process.env,
		PGPASSWORD: decodeURIComponent(connection.password),
		PGSSLMODE: connection.searchParams.get("sslmode") || "require",
	};
	for (const secretName of [
		"SUPABASE_DB_URL",
		"SUPABASE_SERVICE_ROLE_KEY",
		"SUPABASE_ACCESS_TOKEN",
		"VERCEL_TOKEN",
		"GMAIL_APP_PASSWORD",
	]) {
		delete environment[secretName];
	}
	const args = [
		"--format=custom",
		"--no-owner",
		"--no-acl",
		`--host=${connection.hostname}`,
		`--port=${connection.port || "5432"}`,
		`--username=${decodeURIComponent(connection.username)}`,
		`--dbname=${connection.pathname.slice(1)}`,
		`--file=${backupPath}`,
	];
	try {
		await execFileAsync(pgDumpPath, args, { env: environment, timeout: 10 * 60 * 1000 });
	} catch (error) {
		if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
		throw new Error(`Database backup failed${error.code ? ` (${error.code})` : ""}. Confirm pg_dump is installed and the connection is valid.`);
	}
	const stats = fs.statSync(backupPath);
	if (stats.size === 0) {
		fs.unlinkSync(backupPath);
		throw new Error("Database backup completed with an empty file; deployment is not safe.");
	}
	const hash = crypto.createHash("sha256");
	for await (const chunk of fs.createReadStream(backupPath)) hash.update(chunk);
	const metadataPath = `${backupPath}.metadata.json`;
	fs.writeFileSync(metadataPath, JSON.stringify({
		projectRef,
		createdAt: new Date().toISOString(),
		size: stats.size,
		sha256: hash.digest("hex"),
	}), { flag: "wx" });
	console.log(`Database backup created: ${backupPath} (${stats.size} bytes). Verify it before database changes.`);
}

backup().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
