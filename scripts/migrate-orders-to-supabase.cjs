const fs = require("node:fs");
const path = require("node:path");

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ordersFile = path.join(__dirname, "..", "orders.json");
const validStatuses = new Set(["new", "in-progress", "completed", "cancelled"]);

if (!supabaseUrl || !serviceRoleKey) {
	throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before migrating orders.");
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
	throw new Error("SUPABASE_URL must be an HTTPS Supabase project URL.");
}

function loadOrders() {
	try {
		const stored = JSON.parse(fs.readFileSync(ordersFile, "utf8"));
		if (!Array.isArray(stored.orders)) throw new Error("orders.json must contain an orders array.");
		return stored.orders;
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
}

function toDatabaseOrder(order) {
	if (!order || !/^[a-f0-9-]{36}$/i.test(order.id || "") || !/^[a-f0-9-]{36}$/i.test(order.userId || "")) {
		throw new Error("Every order must have a valid UUID id and userId.");
	}
	const quantity = Number(order.quantity ?? 1);
	if (!Number.isInteger(quantity) || quantity < 1 || quantity > 6) {
		throw new Error(`Order ${order.id} has an invalid quantity.`);
	}
	const createdAt = new Date(order.createdAt);
	if (Number.isNaN(createdAt.getTime())) throw new Error(`Order ${order.id} has an invalid createdAt date.`);
	return {
		id: order.id,
		user_id: order.userId,
		message: String(order.message || "").trim(),
		quantity,
		total_amount_grosze: Number(order.totalAmountGrosze) || quantity * 2000,
		payment_status: ["pending", "paid", "cancelled"].includes(order.paymentStatus) ? order.paymentStatus : "pending",
		status: validStatuses.has(order.status) ? order.status : "new",
		created_at: createdAt.toISOString(),
		updated_at: order.updatedAt ? new Date(order.updatedAt).toISOString() : null,
		attachment: order.attachment || null,
	};
}

async function migrate() {
	const orders = loadOrders().map(toDatabaseOrder);
	if (!orders.length) {
		console.log("No orders found in orders.json; nothing to migrate.");
		return;
	}
	for (let offset = 0; offset < orders.length; offset += 100) {
		const batch = orders.slice(offset, offset + 100);
		const response = await fetch(`${supabaseUrl}/rest/v1/orders?on_conflict=id`, {
			method: "POST",
			headers: {
				apikey: serviceRoleKey,
				Authorization: `Bearer ${serviceRoleKey}`,
				"Content-Type": "application/json",
				Prefer: "resolution=merge-duplicates,return=minimal",
			},
			body: JSON.stringify(batch),
		});
		if (!response.ok) {
			const details = await response.text();
			throw new Error(`Supabase migration failed with HTTP ${response.status}: ${details}`);
		}
	}
	console.log(`Migrated ${orders.length} orders. Existing IDs were safely upserted.`);
	console.log("Attachment file contents remain in the local .uploads directory and were not uploaded.");
}

migrate().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
