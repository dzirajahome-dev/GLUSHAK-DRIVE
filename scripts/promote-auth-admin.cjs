const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const workspace = path.resolve(__dirname, "..");

function getVerifiedBackup(projectRef) {
	if (process.env.SUPABASE_BACKUP_CONFIRMED !== "YES") {
		throw new Error("Admin promotion is paused. Verify the backup and project, then set SUPABASE_BACKUP_CONFIRMED=YES.");
	}
	const backupFile = process.env.SUPABASE_AUTH_BACKUP_FILE || "";
	const metadataPath = `${backupFile}.metadata.json`;
	if (!path.isAbsolute(backupFile) || !fs.existsSync(backupFile) || !fs.existsSync(metadataPath)) {
		throw new Error("A verified backup file and its metadata are required before admin promotion.");
	}
	if (backupFile.toLowerCase().startsWith(`${workspace}${path.sep}`.toLowerCase())) {
		throw new Error("The verified database backup must be stored outside the repository.");
	}
	const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
	const stats = fs.statSync(backupFile);
	if (metadata.projectRef !== projectRef || metadata.size !== stats.size || stats.size === 0) {
		throw new Error("The backup does not match the selected Supabase project.");
	}
	return { backupFile, expectedHash: metadata.sha256 };
}

async function sha256File(file) {
	const hash = crypto.createHash("sha256");
	for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
	return hash.digest("hex");
}

async function promote() {
	if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) || !serviceRoleKey) {
		throw new Error("Set a valid SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the secure local environment.");
	}
	const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
	if (process.env.SUPABASE_CONFIRM_PROJECT_REF !== projectRef) {
		throw new Error("Set SUPABASE_CONFIRM_PROJECT_REF to the exact selected project ref.");
	}
	if (process.env.SUPABASE_ADMIN_PROMOTION_APPROVED !== "YES") {
		throw new Error("Admin promotion is paused. Set SUPABASE_ADMIN_PROMOTION_APPROVED=YES only after approving this change.");
	}
	const backup = getVerifiedBackup(projectRef);
	if (await sha256File(backup.backupFile) !== backup.expectedHash) {
		throw new Error("The backup hash does not match its verification metadata.");
	}

	const prompt = readline.createInterface({ input: stdin, output: stdout });
	try {
		const email = (await prompt.question("Email of an existing account to promote: ")).trim().toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
			throw new Error("Enter a valid account email.");
		}
		const confirmation = await prompt.question(`Type PROMOTE ${email} TO ADMIN IN ${projectRef} to continue: `);
		if (confirmation !== `PROMOTE ${email} TO ADMIN IN ${projectRef}`) {
			throw new Error("Confirmation did not match; no account was changed.");
		}

		const response = await fetch(`${supabaseUrl}/rest/v1/rpc/promote_site_user_to_admin`, {
			method: "POST",
			headers: {
				apikey: serviceRoleKey,
				Authorization: `Bearer ${serviceRoleKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ p_email: email }),
		});
		if (!response.ok) {
			throw new Error(`Admin promotion failed with HTTP ${response.status}; check that the reviewed auth schema is installed.`);
		}
		const result = await response.json();
		if (!result || result.role !== "admin" || result.email !== email) {
			throw new Error("No matching existing account was promoted.");
		}
		console.log("Existing account was promoted to administrator.");
	} finally {
		prompt.close();
	}
}

promote().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
