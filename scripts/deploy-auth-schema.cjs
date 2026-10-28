const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || "";
const backupPath = process.env.SUPABASE_AUTH_BACKUP_FILE || "";
const schemaPath = path.join(__dirname, "..", "supabase", "auth-schema.sql");
const workspace = path.resolve(__dirname, "..");

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) || !accessToken) {
	throw new Error("Set SUPABASE_URL and SUPABASE_ACCESS_TOKEN in the secure environment.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (process.env.SUPABASE_CONFIRM_PROJECT_REF !== projectRef) {
	throw new Error("Set SUPABASE_CONFIRM_PROJECT_REF to the exact project ref before applying the schema.");
}
if (process.env.SUPABASE_SCHEMA_DEPLOY_APPROVED !== "YES") {
	throw new Error("Schema deployment is paused. Set SUPABASE_SCHEMA_DEPLOY_APPROVED=YES only after approving this project change.");
}
if (process.env.SUPABASE_BACKUP_CONFIRMED !== "YES"
	|| !backupPath || !fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
	throw new Error("Verify the database backup, then set SUPABASE_BACKUP_CONFIRMED=YES and SUPABASE_AUTH_BACKUP_FILE.");
}
if (!path.isAbsolute(backupPath) || backupPath.toLowerCase().startsWith(`${workspace}${path.sep}`.toLowerCase())) {
	throw new Error("Store the verified database backup outside the repository and provide its absolute path.");
}
const backupMetadataPath = `${backupPath}.metadata.json`;
if (!fs.existsSync(backupMetadataPath)) throw new Error("The backup metadata file is missing.");
const backupMetadata = JSON.parse(fs.readFileSync(backupMetadataPath, "utf8"));
if (backupMetadata.projectRef !== projectRef || backupMetadata.size !== fs.statSync(backupPath).size) {
	throw new Error("The verified backup does not match the selected Supabase project.");
}

async function deploy() {
	const hash = crypto.createHash("sha256");
	for await (const chunk of fs.createReadStream(backupPath)) hash.update(chunk);
	if (hash.digest("hex") !== backupMetadata.sha256) {
		throw new Error("The database backup changed after verification; schema deployment is blocked.");
	}
	const sql = fs.readFileSync(schemaPath, "utf8");
	const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
		method: "POST",
		headers: {
			Authorization: `******`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query: sql }),
	});
	if (!response.ok) {
		throw new Error(`Supabase schema deployment failed with HTTP ${response.status}. No production deployment was attempted.`);
	}
	console.log(`Auth schema applied to Supabase project ${projectRef}.`);
}

deploy().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
