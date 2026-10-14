const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const tf = require("@tensorflow/tfjs");
const nsfwjs = require("nsfwjs");
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");
const geoip = require("geoip-lite");

const files = {
	"/": { name: "index.html", type: "text/html; charset=utf-8" },
	"/index.html": { name: "index.html", type: "text/html; charset=utf-8" },
	"/account": { name: "account.html", type: "text/html; charset=utf-8" },
	"/account.html": { name: "account.html", type: "text/html; charset=utf-8" },
	"/studio": { name: "studio.html", type: "text/html; charset=utf-8" },
	"/studio.html": { name: "studio.html", type: "text/html; charset=utf-8" },
	"/analytics.js": { name: "analytics.js", type: "text/javascript; charset=utf-8" },
	"/account.js": { name: "account.js", type: "text/javascript; charset=utf-8" },
	"/comments.js": { name: "comments.js", type: "text/javascript; charset=utf-8" },
	"/messages.js": { name: "messages.js", type: "text/javascript; charset=utf-8" },
	"/support.js": { name: "support.js", type: "text/javascript; charset=utf-8" },
	"/works.js": { name: "works.js", type: "text/javascript; charset=utf-8" },
	"/notifications.js": { name: "notifications.js", type: "text/javascript; charset=utf-8" },
	"/community-badges.js": { name: "community-badges.js", type: "text/javascript; charset=utf-8" },
	"/i18n.js": { name: "i18n.js", type: "text/javascript; charset=utf-8" },
	"/channel-banner.jpg": { name: "channel-banner.jpg", type: "image/jpeg" },
	"/channel-avatar.jpg": { name: "channel-avatar.jpg", type: "image/jpeg" },
};
const analyticsPath = path.join(__dirname, "analytics.json");
const accountsPath = path.join(__dirname, "users.json");
const ordersPath = path.join(__dirname, "orders.json");
const paymentsPath = path.join(__dirname, "payments.json");
const commentsPath = path.join(__dirname, "comments.json");
const messagesPath = path.join(__dirname, "messages.json");
const engagementPath = path.join(__dirname, "engagement.json");
const supportSettingsPath = path.join(__dirname, "support-settings.json");
const orderSettingsPath = path.join(__dirname, "order-settings.json");
const worksPath = path.join(__dirname, "works.json");
const uploadsPath = path.join(__dirname, ".uploads");
const messageUploadsPath = path.join(uploadsPath, "messages");
const sessionCookie = "glushak_session";
const requestRateLimits = new Map();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";
const secureCookies = process.env.SECURE_COOKIES === "true";
const loopbackHosts = ["127.0.0.1", "::1", "localhost"];
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseOrdersEnabled = Boolean(supabaseUrl && supabaseServiceRoleKey);
const weeklyOrderLimit = 6;
const videoPriceGrosze = 2000;
const maxOrderAttachmentBytes = 100 * 1024 * 1024;
const maxOrderRequestLength = Math.ceil(maxOrderAttachmentBytes * 4 / 3) + 1024 * 1024;
const maxMessageImageBytes = 5 * 1024 * 1024;
const maxMessageRequestLength = Math.ceil(maxMessageImageBytes * 4 / 3) + 64 * 1024;
const messageRetentionMs = 365 * 24 * 60 * 60 * 1000;
const dummyPasswordSalt = "2f09c9e1243768ab3d8075f61a4bce90";
const dummyPasswordUser = {
	salt: dummyPasswordSalt,
	passwordHash: crypto.scryptSync("not-a-real-account-password", dummyPasswordSalt, 64).toString("hex"),
};
const rateLimitPolicies = [
	{ matches: (request, pathname) => pathname === "/api/auth/login" && request.method === "POST", maximum: 10, windowMs: 15 * 60 * 1000 },
	{ matches: (request, pathname) => pathname === "/api/auth/register" && request.method === "POST", maximum: 8, windowMs: 60 * 60 * 1000 },
	{ matches: (request, pathname) => pathname === "/api/messages" && request.method === "POST", maximum: 10, windowMs: 60 * 1000 },
	{ matches: (request, pathname) => pathname === "/api/track" && request.method === "POST", maximum: 60, windowMs: 60 * 1000 },
	{ matches: (request, pathname) => pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method), maximum: 60, windowMs: 60 * 1000 },
];
let localOrderWriteQueue = Promise.resolve();
let messageWriteQueue = Promise.resolve();
let engagementWriteQueue = Promise.resolve();
let nsfwModelPromise;

if (Boolean(supabaseUrl) !== Boolean(supabaseServiceRoleKey)) {
	throw new Error("Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable Supabase orders.");
}
if (supabaseOrdersEnabled && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
	throw new Error("SUPABASE_URL must be an HTTPS Supabase project URL.");
}

if (!loopbackHosts.includes(host) && !secureCookies) {
	throw new Error("Set SECURE_COOKIES=true before exposing the server beyond localhost.");
}

function setSecurityHeaders(response) {
	response.setHeader("X-Content-Type-Options", "nosniff");
	response.setHeader("X-Frame-Options", "DENY");
	response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
	response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
	response.setHeader("Content-Security-Policy", getContentSecurityPolicy());
	if (secureCookies) response.setHeader("Strict-Transport-Security", "max-age=31536000");
}

function getContentSecurityPolicy(scriptNonce) {
	return [
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"form-action 'self'",
		`script-src 'self'${scriptNonce ? ` 'nonce-${scriptNonce}'` : ""}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"media-src 'self' blob:",
		"connect-src 'self'",
		"frame-src https://www.youtube.com https://www.youtube-nocookie.com",
	].join("; ");
}

function getRequestRateLimit(request, pathname) {
	return rateLimitPolicies.find((policy) => policy.matches(request, pathname));
}

function enforceRequestRateLimit(request, response, pathname) {
	const policy = getRequestRateLimit(request, pathname);
	if (!policy) return false;
	const remoteAddress = (request.socket.remoteAddress || "unknown").replace(/^::ffff:/i, "");
	const key = `${pathname}:${request.method}:${remoteAddress}`;
	const now = Date.now();
	if (requestRateLimits.size >= 5000) {
		for (const [storedKey, storedEntry] of requestRateLimits) {
			if (storedEntry.resetAt <= now) requestRateLimits.delete(storedKey);
		}
	}
	if (!requestRateLimits.has(key) && requestRateLimits.size >= 10000) {
		response.setHeader("Retry-After", "60");
		sendJson(response, 503, { error: "Usługa jest chwilowo przeciążona. Spróbuj ponownie za chwilę." });
		return true;
	}
	let entry = requestRateLimits.get(key);
	if (!entry || entry.resetAt <= now) {
		entry = { count: 0, resetAt: now + policy.windowMs };
		requestRateLimits.set(key, entry);
	}
	entry.count += 1;
	if (entry.count <= policy.maximum) return false;
	response.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
	const error = pathname.startsWith("/api/auth/")
		? "Za dużo prób. Spróbuj ponownie za 15 minut."
		: "Zbyt wiele żądań. Spróbuj ponownie za chwilę.";
	sendJson(response, 429, { error });
	return true;
}

function isSameOriginMutation(request, pathname) {
	if (!pathname.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
	const origin = request.headers.origin;
	const hostHeader = request.headers.host;
	if (typeof origin !== "string" || typeof hostHeader !== "string") return false;
	try {
		const originUrl = new URL(origin);
		if (!["http:", "https:"].includes(originUrl.protocol)
			|| originUrl.host.toLowerCase() !== hostHeader.toLowerCase()
			|| originUrl.username || originUrl.password) return false;
	} catch {
		return false;
	}
	const fetchSite = request.headers["sec-fetch-site"];
	return fetchSite === undefined || fetchSite === "same-origin";
}

function sendJson(response, status, value) {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	response.end(JSON.stringify(value));
}

async function readJsonBody(request, maximumLength = 4096) {
	let bodyText = "";
	for await (const chunk of request) {
		bodyText += chunk;
		if (bodyText.length > maximumLength) {
			const error = new Error("Request too large");
			error.status = 413;
			throw error;
		}
	}
	try {
		return JSON.parse(bodyText);
	} catch {
		const error = new Error("Invalid JSON");
		error.status = 400;
		throw error;
	}
}

function readAccounts() {
	try {
		const stored = JSON.parse(fs.readFileSync(accountsPath, "utf8"));
		return {
			users: Array.isArray(stored.users) ? stored.users : [],
			sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
		};
	} catch (error) {
		if (error.code === "ENOENT") return { users: [], sessions: [] };
		throw error;
	}
}

function readRows(filePath, key) {
	try {
		const stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
		return Array.isArray(stored[key]) ? stored[key] : [];
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
}

function writeRows(filePath, key, rows) {
	fs.writeFileSync(filePath, JSON.stringify({ [key]: rows }));
}

function withMessageStoreLock(operation) {
	const result = messageWriteQueue.then(operation, operation);
	messageWriteQueue = result.catch(() => {});
	return result;
}

function messageImageFile(imageId) {
	return path.join(messageUploadsPath, imageId);
}

function removeMessageImage(imageId) {
	if (typeof imageId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)) return;
	try {
		fs.unlinkSync(messageImageFile(imageId));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}

function pruneExpiredMessages() {
	const messages = readRows(messagesPath, "messages");
	const cutoff = Date.now() - messageRetentionMs;
	const retained = messages.filter((message) => {
		const timestamp = Date.parse(message.sentAt);
		return Number.isFinite(timestamp) && timestamp >= cutoff;
	});
	if (retained.length !== messages.length) writeRows(messagesPath, "messages", retained);
	const retainedImageIds = new Set(retained.map((message) => message.imageId).filter(Boolean));
	fs.mkdirSync(messageUploadsPath, { recursive: true });
	for (const file of fs.readdirSync(messageUploadsPath)) {
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(file)
			&& !retainedImageIds.has(file)) {
			removeMessageImage(file);
		}
	}
	return retained;
}

function readEngagementState() {
	try {
		const stored = JSON.parse(fs.readFileSync(engagementPath, "utf8"));
		if (!stored || !stored.users || typeof stored.users !== "object" || Array.isArray(stored.users)) {
			throw new Error("Invalid engagement state.");
		}
		return stored;
	} catch (error) {
		if (error.code === "ENOENT") return { users: {} };
		throw error;
	}
}

function writeEngagementState(state) {
	fs.writeFileSync(engagementPath, JSON.stringify(state));
}

function withEngagementLock(operation) {
	const result = engagementWriteQueue.then(operation, operation);
	engagementWriteQueue = result.catch(() => {});
	return result;
}

function getCommunityBadges(userId) {
	const commentCount = readCleanComments().filter((comment) => comment.userId === userId).length;
	return {
		commentCount,
		badges: [
			{ id: "first-comment", threshold: 1, earned: commentCount >= 1 },
			{ id: "active-voice", threshold: 5, earned: commentCount >= 5 },
			{ id: "community-voice", threshold: 10, earned: commentCount >= 10 },
		],
	};
}

async function getUserNotifications(userId) {
	return withEngagementLock(async () => {
		const [orders, works] = await Promise.all([
			getStoredOrders(userId),
			Promise.resolve(readRows(worksPath, "works")),
		]);
		const state = readEngagementState();
		const current = state.users[userId];
		const currentWorkIds = works.map((work) => work.id).filter((id) => typeof id === "string");
		const currentOrders = Object.fromEntries(orders.map((order) => [order.id, {
			status: order.status || "new",
			paymentStatus: order.paymentStatus || "pending",
		}]));
		if (!current) {
			state.users[userId] = {
				knownWorks: currentWorkIds,
				knownOrders: currentOrders,
				notifications: [],
			};
			writeEngagementState(state);
			return { notifications: [], unreadCount: 0 };
		}

		const knownWorkList = Array.isArray(current.knownWorks) ? current.knownWorks : [];
		const knownWorkIds = new Set(knownWorkList);
		const notifications = Array.isArray(current.notifications) ? current.notifications : [];
		const now = new Date().toISOString();
		let hasChanges = knownWorkIds.size !== knownWorkList.length || !Array.isArray(current.notifications);
		for (const work of works) {
			if (typeof work.id !== "string" || knownWorkIds.has(work.id)) continue;
			notifications.push({
				id: crypto.randomUUID(),
				type: "new-work",
				workTitle: work.title,
				createdAt: now,
				read: false,
			});
			knownWorkIds.add(work.id);
			hasChanges = true;
		}
		const previousOrders = current.knownOrders || {};
		const previousOrderIds = Object.keys(previousOrders);
		for (const [orderId, order] of Object.entries(currentOrders)) {
			const previous = previousOrders[orderId];
			if (!previous) {
				hasChanges = true;
				continue;
			}
			if (previous.status !== order.status) {
				notifications.push({
					id: crypto.randomUUID(),
					type: "order-status",
					orderId,
					value: order.status,
					createdAt: now,
					read: false,
				});
				hasChanges = true;
			}
			if (previous.paymentStatus !== order.paymentStatus) {
				notifications.push({
					id: crypto.randomUUID(),
					type: "payment-status",
					orderId,
					value: order.paymentStatus,
					createdAt: now,
					read: false,
				});
				hasChanges = true;
			}
		}
		if (previousOrderIds.length !== Object.keys(currentOrders).length
			|| previousOrderIds.some((id) => !currentOrders[id])) hasChanges = true;
		if (hasChanges) {
			current.knownWorks = [...knownWorkIds];
			current.knownOrders = currentOrders;
			current.notifications = notifications.slice(-50);
			writeEngagementState(state);
		}
		const visibleNotifications = [...current.notifications].reverse();
		return {
			notifications: visibleNotifications,
			unreadCount: current.notifications.filter((notification) => !notification.read).length,
		};
	});
}

function inspectMessageImage(buffer) {
	const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	let mimeType;
	let width;
	let height;
	if (buffer.length >= 24 && buffer.subarray(0, 8).equals(pngSignature)) {
		mimeType = "image/png";
		width = buffer.readUInt32BE(16);
		height = buffer.readUInt32BE(20);
		for (let offset = 8; offset + 12 <= buffer.length;) {
			const chunkLength = buffer.readUInt32BE(offset);
			if (chunkLength > buffer.length - offset - 12) throw new Error("Wybierz obraz JPG lub PNG.");
			if (buffer.toString("ascii", offset + 4, offset + 8) === "acTL") {
				throw new Error("Wybierz statyczny obraz JPG lub PNG.");
			}
			offset += chunkLength + 12;
		}
	} else if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
		mimeType = "image/jpeg";
		let offset = 2;
		while (offset < buffer.length) {
			if (buffer[offset] !== 0xff) throw new Error("Wybierz obraz JPG lub PNG.");
			while (buffer[offset] === 0xff) offset += 1;
			const marker = buffer[offset];
			offset += 1;
			if (marker === 0xd9 || marker === 0xda) break;
			if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
			if (offset + 2 > buffer.length) throw new Error("Wybierz obraz JPG lub PNG.");
			const segmentLength = buffer.readUInt16BE(offset);
			if (segmentLength < 2 || offset + segmentLength > buffer.length) throw new Error("Wybierz obraz JPG lub PNG.");
			if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
				if (segmentLength < 7) throw new Error("Wybierz obraz JPG lub PNG.");
				height = buffer.readUInt16BE(offset + 3);
				width = buffer.readUInt16BE(offset + 5);
				break;
			}
			offset += segmentLength;
		}
	} else {
		throw new Error("Wybierz obraz JPG lub PNG.");
	}
	if (!width || !height || width * height > 12_000_000) {
		throw new Error("Obraz ma nieprawidłowe lub zbyt duże wymiary.");
	}
	return mimeType;
}

function decodeMessageImage(buffer, mimeType) {
	const decoded = mimeType === "image/jpeg"
		? jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true })
		: PNG.sync.read(buffer);
	if (!decoded.width || !decoded.height || decoded.width * decoded.height > 12_000_000) {
		throw new Error("Invalid image dimensions.");
	}
	const rgba = tf.tensor3d(decoded.data, [decoded.height, decoded.width, 4], "int32");
	try {
		return rgba.slice([0, 0, 0], [decoded.height, decoded.width, 3]);
	} finally {
		rgba.dispose();
	}
}

async function classifyMessageImage(image) {
	if (!nsfwModelPromise) {
		nsfwModelPromise = (async () => {
			await tf.ready();
			return nsfwjs.load();
		})().catch((error) => {
			nsfwModelPromise = undefined;
			throw error;
		});
	}
	const model = await nsfwModelPromise;
	const predictions = await model.classify(image);
	const scores = new Map(predictions.map((prediction) => [prediction.className, prediction.probability]));
	return (scores.get("Porn") || 0) >= 0.2
		|| (scores.get("Hentai") || 0) >= 0.2
		|| (scores.get("Sexy") || 0) >= 0.6;
}

const inappropriateCommentTerms = [
	"kurw", "chuj", "huj", "jeb", "pierd", "spierdal", "wypierdal", "skurw", "zjeb", "dziwk", "cwel",
	"fuck", "shit", "bitch", "asshole", "bastard", "motherf", "cunt",
];

function isInappropriateComment(message) {
	if (typeof message !== "string") return false;
	const normalizedWords = message.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[013457@$]/g, (character) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" })[character])
		.split(/\s+/)
		.map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""));
	return normalizedWords.some((word) => inappropriateCommentTerms.some((term) => word.includes(term)));
}

function readCleanComments() {
	const comments = readRows(commentsPath, "comments");
	const cleanComments = comments.filter((comment) => !isInappropriateComment(comment.message));
	if (cleanComments.length !== comments.length) writeRows(commentsPath, "comments", cleanComments);
	return cleanComments;
}

function mapSupabaseOrder(row) {
	const quantity = row.quantity || 1;
	return {
		id: row.id,
		userId: row.user_id,
		message: row.message,
		quantity,
		totalAmountGrosze: Number(row.total_amount_grosze) || quantity * videoPriceGrosze,
		paymentStatus: row.payment_status || "pending",
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at || undefined,
		attachment: row.attachment || undefined,
	};
}

async function supabaseRequest(tablePath, options = {}) {
	if (!supabaseOrdersEnabled) throw new Error("Supabase orders are not configured.");
	const response = await fetch(`${supabaseUrl}/rest/v1/${tablePath}`, {
		...options,
		headers: {
			apikey: supabaseServiceRoleKey,
			Authorization: `Bearer ${supabaseServiceRoleKey}`,
			"Content-Type": "application/json",
			...options.headers,
		},
	});
	const responseText = await response.text();
	let body;
	try {
		body = responseText ? JSON.parse(responseText) : null;
	} catch {
		body = responseText;
	}
	if (!response.ok) {
		const error = new Error(`Supabase request failed with HTTP ${response.status}.`);
		error.status = response.status;
		error.code = body && typeof body === "object" ? body.code : undefined;
		error.details = body && typeof body === "object" ? body.message : undefined;
		throw error;
	}
	return body;
}

async function readSupabaseOrders(userId) {
	const allOrders = [];
	for (let offset = 0; ; offset += 500) {
		const params = new URLSearchParams({ select: "*", order: "created_at.desc", limit: "500" });
		if (userId) params.set("user_id", `eq.${userId}`);
		const rows = await supabaseRequest(`orders?${params}`, {
			headers: { Range: `${offset}-${offset + 499}` },
		});
		allOrders.push(...rows.map(mapSupabaseOrder));
		if (rows.length < 500) return allOrders;
	}
}

function currentUtcWeekBounds() {
	const start = new Date();
	start.setUTCHours(0, 0, 0, 0);
	start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
	const end = new Date(start);
	end.setUTCDate(end.getUTCDate() + 7);
	return { start: start.toISOString(), end: end.toISOString() };
}

async function getWeeklyOrderCapacity() {
	const { start, end } = currentUtcWeekBounds();
	let rows;
	if (supabaseOrdersEnabled) {
		const params = new URLSearchParams({
			select: "quantity",
			and: `(created_at.gte.${start},created_at.lt.${end})`,
			status: "neq.cancelled",
			order: "created_at.asc",
		});
		rows = await supabaseRequest(`orders?${params}`);
	} else {
		rows = readRows(ordersPath, "orders").filter((order) =>
			order.createdAt >= start && order.createdAt < end && order.status !== "cancelled");
	}
	const used = rows.reduce((total, order) => total + (Number(order.quantity) || 1), 0);
	return { limit: weeklyOrderLimit, used, remaining: Math.max(0, weeklyOrderLimit - used), weekStartsAt: start };
}

async function getStoredOrders(userId) {
	if (supabaseOrdersEnabled) return readSupabaseOrders(userId);
	return readRows(ordersPath, "orders")
		.filter((order) => !userId || order.userId === userId)
		.map((order) => ({
			quantity: 1,
			paymentStatus: "pending",
			...order,
			totalAmountGrosze: Number(order.totalAmountGrosze) || (Number(order.quantity) || 1) * videoPriceGrosze,
		}));
}

async function insertStoredOrder(order) {
	const result = await supabaseRequest("rpc/create_order_if_capacity", {
		method: "POST",
		body: JSON.stringify({
			p_id: order.id,
			p_user_id: order.userId,
			p_message: order.message,
			p_quantity: order.quantity,
			p_status: order.status,
			p_created_at: order.createdAt,
			p_attachment: order.attachment || null,
			p_total_amount_grosze: order.totalAmountGrosze,
		}),
	});
	if (!result || !result.order) throw new Error("Supabase order RPC returned an invalid response.");
	return { order: mapSupabaseOrder(result.order), capacity: result.capacity };
}

async function saveOrderWithinCapacity(order) {
	if (supabaseOrdersEnabled) return insertStoredOrder(order);

	let releaseLock;
	const queued = localOrderWriteQueue;
	localOrderWriteQueue = new Promise((resolve) => { releaseLock = resolve; });
	await queued;
	try {
		const capacity = await getWeeklyOrderCapacity();
		if (order.quantity > capacity.remaining) return { order: null, capacity };
		const orders = readRows(ordersPath, "orders");
		orders.push(order);
		writeRows(ordersPath, "orders", orders);
		return { order, capacity: { ...capacity, used: capacity.used + order.quantity, remaining: capacity.remaining - order.quantity } };
	} finally {
		releaseLock();
	}
}

async function findStoredOrder(orderId) {
	if (supabaseOrdersEnabled) {
		const params = new URLSearchParams({ select: "*", id: `eq.${orderId}`, limit: "1" });
		const rows = await supabaseRequest(`orders?${params}`);
		return rows.length ? mapSupabaseOrder(rows[0]) : null;
	}
	const order = readRows(ordersPath, "orders").find((item) => item.id === orderId);
	return order ? {
		quantity: 1,
		paymentStatus: "pending",
		...order,
		totalAmountGrosze: Number(order.totalAmountGrosze) || (Number(order.quantity) || 1) * videoPriceGrosze,
	} : null;
}

async function updateStoredOrderStatus(orderId, status) {
	if (supabaseOrdersEnabled) {
		const result = await supabaseRequest("rpc/update_order_status_if_capacity", {
			method: "POST",
			body: JSON.stringify({ p_id: orderId, p_status: status }),
		});
		if (!result || !result.order) return null;
		return { ...mapSupabaseOrder(result.order), orderCapacity: result.capacity };
	}
	let releaseLock;
	const queued = localOrderWriteQueue;
	localOrderWriteQueue = new Promise((resolve) => { releaseLock = resolve; });
	await queued;
	try {
		const orders = readRows(ordersPath, "orders");
		const order = orders.find((item) => item.id === orderId);
		if (!order) return null;
		const wasCancelled = order.status === "cancelled";
		if (wasCancelled && status !== "cancelled") {
			const capacity = await getWeeklyOrderCapacity();
			const { start, end } = currentUtcWeekBounds();
			if (order.createdAt >= start && order.createdAt < end && (order.quantity || 1) > capacity.remaining) {
				const error = new Error("WEEKLY_ORDER_CAPACITY");
				error.capacity = capacity;
				throw error;
			}
		}
		order.status = status;
		order.updatedAt = new Date().toISOString();
		writeRows(ordersPath, "orders", orders);
		return order;
	} finally {
		releaseLock();
	}
}

async function updateStoredOrderPaymentStatus(orderId, paymentStatus) {
	if (supabaseOrdersEnabled) {
		const params = new URLSearchParams({ select: "*", id: `eq.${orderId}` });
		const rows = await supabaseRequest(`orders?${params}`, {
			method: "PATCH",
			headers: { Prefer: "return=representation" },
			body: JSON.stringify({ payment_status: paymentStatus }),
		});
		return rows.length ? mapSupabaseOrder(rows[0]) : null;
	}
	let releaseLock;
	const queued = localOrderWriteQueue;
	localOrderWriteQueue = new Promise((resolve) => { releaseLock = resolve; });
	await queued;
	try {
		const orders = readRows(ordersPath, "orders");
		const order = orders.find((item) => item.id === orderId);
		if (!order) return null;
		order.totalAmountGrosze = Number(order.totalAmountGrosze) || (Number(order.quantity) || 1) * videoPriceGrosze;
		order.paymentStatus = paymentStatus;
		writeRows(ordersPath, "orders", orders);
		return order;
	} finally {
		releaseLock();
	}
}

function makeOrderPaymentInstructions(order) {
	const settings = readSupportSettings();
	if (!settings) return null;
	return {
		holder: settings.holder,
		iban: settings.iban,
		amountGrosze: order.totalAmountGrosze,
		currency: "PLN",
		title: `GLUSHAK DRIVE ZAMOWIENIE ${order.id.slice(0, 8).toUpperCase()}`,
	};
}

function sendOrderStorageError(response, error, message) {
	console.error(message, error);
	sendJson(response, 503, { error: message });
}

function canManage(user) {
	return user?.role === "admin";
}

function safeDownloadName(name) {
	const clean = path.basename(String(name || "plik"))
		.replace(/[\\/\r\n\0]/g, "_")
		.replace(/[<>:"|?*]/g, "_")
		.trim()
		.slice(0, 120);
	return clean || "plik";
}

function normalizeIban(value) {
	if (typeof value !== "string") return null;
	let iban = value.replace(/[\s-]/g, "").toUpperCase();
	if (/^\d{26}$/.test(iban)) iban = `PL${iban}`;
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
	const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
	let remainder = 0;
	for (const character of rearranged) {
		const digits = character >= "A" && character <= "Z"
			? String(character.charCodeAt(0) - 55)
			: character;
		for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
	}
	return remainder === 1 ? iban : null;
}

function youtubeVideoId(value) {
	if (typeof value !== "string" || value.length > 500) return null;
	let url;
	try {
		url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port
		|| !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname.toLowerCase())) return null;
	let id = "";
	if (url.hostname.toLowerCase() === "youtu.be") {
		id = url.pathname.split("/").filter(Boolean)[0] || "";
	} else if (url.pathname === "/watch") {
		id = url.searchParams.get("v") || "";
	} else {
		const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/);
		id = match ? match[1] : "";
	}
	return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function readSupportSettings() {
	try {
		const settings = JSON.parse(fs.readFileSync(supportSettingsPath, "utf8"));
		return typeof settings.holder === "string" && typeof settings.iban === "string"
			? { holder: settings.holder, iban: settings.iban, enabled: settings.enabled === true }
			: null;
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

function readOrderSettings() {
	try {
		const settings = JSON.parse(fs.readFileSync(orderSettingsPath, "utf8"));
		if (typeof settings.enabled !== "boolean") throw new Error("Invalid order settings.");
		return { enabled: settings.enabled };
	} catch (error) {
		if (error.code === "ENOENT") return { enabled: true };
		throw error;
	}
}

function writeAccounts(accounts) {
	fs.writeFileSync(accountsPath, JSON.stringify(accounts));
}

function getCookie(request, name) {
	const prefix = `${name}=`;
	const cookie = (request.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
	return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : "";
}

function getCurrentUser(request, accounts = readAccounts()) {
	const token = getCookie(request, sessionCookie);
	if (!token) return null;
	const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
	const session = accounts.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > Date.now());
	return session ? accounts.users.find((user) => user.id === session.userId) || null : null;
}

function publicUser(user) {
	return user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null;
}

function setSessionCookie(response, token, maxAge = 60 * 60 * 24 * 7) {
	const secure = secureCookies ? "; Secure" : "";
	response.setHeader("Set-Cookie", `${sessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`);
}

function createSession(accounts, user) {
	const token = crypto.randomBytes(32).toString("hex");
	accounts.sessions = accounts.sessions.filter((session) => session.expiresAt > Date.now());
	accounts.sessions.push({
		tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
		userId: user.id,
		expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
	});
	return token;
}

function hashPassword(password, salt) {
	return crypto.scryptSync(password, salt, 64).toString("hex");
}

function passwordMatches(password, user) {
	const candidate = Buffer.from(hashPassword(password, user.salt), "hex");
	const expected = Buffer.from(user.passwordHash, "hex");
	return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function isValidAccount(name, email, password) {
	return typeof name === "string"
		&& name.trim().length >= 2
		&& name.trim().length <= 50
		&& typeof email === "string"
		&& email.length <= 254
		&& /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
		&& typeof password === "string"
		&& password.length >= 10
		&& password.length <= 256;
}

function handleAuthRequest(request, response, pathname) {
	if (pathname === "/api/auth/me" && request.method === "GET") {
		const accounts = readAccounts();
		const user = getCurrentUser(request, accounts);
		sendJson(response, 200, {
			user: publicUser(user),
			setupAvailable: !accounts.users.some((item) => item.role === "admin"),
		});
		return true;
	}
	if (!["/api/auth/login", "/api/auth/register", "/api/auth/logout"].includes(pathname)) return false;
	if (request.method !== "POST") {
		sendJson(response, 405, { error: "Method not allowed" });
		return true;
	}

	void (async () => {
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			sendJson(response, error.status || 400, { error: error.message });
			return;
		}
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			sendJson(response, 400, { error: "Nieprawidłowe dane żądania." });
			return;
		}

		const accounts = readAccounts();
		if (pathname === "/api/auth/logout") {
			const token = getCookie(request, sessionCookie);
			const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
			accounts.sessions = accounts.sessions.filter((session) => session.tokenHash !== tokenHash);
			writeAccounts(accounts);
			setSessionCookie(response, "", 0);
			sendJson(response, 200, { ok: true });
			return;
		}

		const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
		const suppliedPassword = typeof body.password === "string" ? body.password : "";
		const password = suppliedPassword.slice(0, 256);
		if (pathname === "/api/auth/login") {
			const user = accounts.users.find((item) => item.email === email);
			const passwordMatchesAccount = passwordMatches(password, user || dummyPasswordUser);
			if (!user || suppliedPassword.length > 256 || !passwordMatchesAccount) {
				sendJson(response, 401, { error: "Nieprawidłowy e-mail lub hasło." });
				return;
			}
			const token = createSession(accounts, user);
			writeAccounts(accounts);
			setSessionCookie(response, token);
			sendJson(response, 200, { user: publicUser(user), setupAvailable: false });
			return;
		}

		const name = typeof body.name === "string" ? body.name.trim() : "";
		if (!isValidAccount(name, email, password)) {
			sendJson(response, 400, { error: "Wpisz nazwę, prawidłowy e-mail i hasło (co najmniej 10 znaków)." });
			return;
		}
		if (accounts.users.some((user) => user.email === email)) {
			sendJson(response, 409, { error: "Konto z tym adresem e-mail już istnieje." });
			return;
		}

		const currentUser = getCurrentUser(request, accounts);
		const role = accounts.users.some((user) => user.role === "admin") ? "user" : "admin";
		const salt = crypto.randomBytes(16).toString("hex");
		const user = {
			id: crypto.randomUUID(),
			name,
			email,
			role,
			salt,
			passwordHash: hashPassword(password, salt),
			createdAt: new Date().toISOString(),
		};
		accounts.users.push(user);
		if (currentUser?.role !== "admin") {
			const token = createSession(accounts, user);
			setSessionCookie(response, token);
		}
		writeAccounts(accounts);
		sendJson(response, 201, {
			user: publicUser(currentUser?.role === "admin" ? currentUser : user),
			created: publicUser(user),
			setupAvailable: false,
		});
	})().catch(() => {
		if (!response.headersSent) sendJson(response, 500, { error: "Wystąpił błąd serwera." });
	});
	return true;
}

function readEvents() {
	try {
		const stored = JSON.parse(fs.readFileSync(analyticsPath, "utf8"));
		return Array.isArray(stored.events) ? stored.events : [];
	} catch {
		return [];
	}
}

function getCountryCode(remoteAddress) {
	const address = remoteAddress?.replace(/^::ffff:/i, "");
	const result = address ? geoip.lookup(address) : null;
	return result?.country && /^[A-Z]{2}$/.test(result.country) ? result.country : "Nieznane";
}

function summarize(events) {
	const views = events.filter((event) => event.type === "pageview");
	const clicks = events.filter((event) => event.type === "click");
	const countBy = (items, getLabel) => {
		const counts = new Map();
		for (const item of items) {
			const label = getLabel(item);
			counts.set(label, (counts.get(label) || 0) + 1);
		}
		return [...counts.entries()]
			.map(([label, count]) => ({ label, count }))
			.sort((left, right) => right.count - left.count);
	};
	const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
	const today = new Date();
	const dailyViews = Array.from({ length: 7 }, (_, index) => {
		const date = new Date(today);
		date.setDate(today.getDate() - (6 - index));
		const key = dayKey(date);
		return {
			date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
			label: new Intl.DateTimeFormat("pl-PL", { weekday: "short" }).format(date),
			count: views.filter((event) => dayKey(new Date(event.timestamp)) === key).length,
		};
	});

	return {
		views: views.length,
		sessions: new Set(views.map((event) => event.session)).size,
		socialClicks: clicks.length,
		platforms: countBy(clicks, (event) => event.target || "Inne"),
		sources: countBy(views, (event) => event.source || "Bezpośrednie"),
		devices: countBy(views, (event) => event.device || "Nieznane"),
		countries: countBy(views.filter((event) => typeof event.country === "string"), (event) => event.country),
		dailyViews,
		recent: events.slice(-20).reverse().map(({ timestamp, type, source, device, target, country }) => ({
			timestamp,
			type,
			source,
			device,
			target,
			country,
		})),
	};
}

async function handleRequest(request, response) {
	let url;
	try {
		url = new URL(request.url, "http://localhost");
	} catch {
		response.writeHead(400).end("Bad request");
		return;
	}
	if (url.pathname.startsWith("/api/auth/")) {
		if (handleAuthRequest(request, response, url.pathname)) return;
	}

	if (url.pathname === "/api/support/status") {
		if (request.method !== "GET") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		const settings = readSupportSettings();
		sendJson(response, 200, { enabled: Boolean(settings?.enabled) });
		return;
	}

	if (url.pathname === "/api/support/settings") {
		const user = getCurrentUser(request);
		if (!canManage(user)) {
			sendJson(response, user ? 403 : 401, { error: "Dostęp tylko dla administratora." });
			return;
		}
		if (request.method === "GET") {
			const settings = readSupportSettings();
			sendJson(response, 200, { configured: Boolean(settings), enabled: Boolean(settings?.enabled), holder: settings?.holder || "", iban: settings?.iban || "" });
			return;
		}
		if (request.method !== "POST") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			sendJson(response, error.status || 400, { error: error.message });
			return;
		}
		const holder = body && typeof body.holder === "string" ? body.holder.trim() : "";
		const iban = normalizeIban(body?.iban);
		if (holder.length < 2 || holder.length > 80 || !iban) {
			sendJson(response, 400, { error: "Podaj nazwę odbiorcy oraz prawidłowy numer IBAN." });
			return;
		}
		try {
			const previousSettings = readSupportSettings();
			fs.writeFileSync(supportSettingsPath, JSON.stringify({ holder, iban, enabled: Boolean(previousSettings?.enabled) }));
		} catch {
			sendJson(response, 500, { error: "Nie udało się zapisać danych rachunku." });
			return;
		}
		sendJson(response, 200, { configured: true, holder, iban });
		return;
	}

	if (url.pathname === "/api/support/visibility") {
		const user = getCurrentUser(request);
		if (!canManage(user)) {
			sendJson(response, user ? 403 : 401, { error: "Dostęp tylko dla administratora." });
			return;
		}
		if (request.method !== "POST") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			sendJson(response, error.status || 400, { error: error.message });
			return;
		}
		if (typeof body?.enabled !== "boolean") {
			sendJson(response, 400, { error: "Nieprawidłowe ustawienie widoczności wsparcia." });
			return;
		}
		const settings = readSupportSettings();
		if (body.enabled && !settings) {
			sendJson(response, 400, { error: "Najpierw zapisz prawidłowe dane rachunku." });
			return;
		}
		try {
			fs.writeFileSync(supportSettingsPath, JSON.stringify({
				...(settings || {}),
				enabled: body.enabled,
			}));
		} catch {
			sendJson(response, 500, { error: "Nie udało się zapisać widoczności wsparcia." });
			return;
		}
		sendJson(response, 200, { enabled: body.enabled });
		return;
	}

	if (url.pathname === "/api/support/transfer-details") {
		if (request.method !== "POST") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			sendJson(response, error.status || 400, { error: error.message });
			return;
		}
		const amountValue = body?.amount;
		const amountText = typeof amountValue === "number" ? String(amountValue) : amountValue;
		const amount = typeof amountText === "string" && /^\d+(?:\.\d{1,2})?$/.test(amountText)
			? Number(amountText)
			: Number.NaN;
		if (!Number.isFinite(amount) || amount < 1 || amount > 1000000
			|| Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
			sendJson(response, 400, { error: "Kwota musi wynosić od 1 do 1 000 000 zł i mieć maksymalnie dwa miejsca po przecinku." });
			return;
		}
		const settings = readSupportSettings();
		if (!settings) {
			sendJson(response, 503, { error: "Dane rachunku do wsparcia nie zostały jeszcze skonfigurowane." });
			return;
		}
		if (!settings.enabled) {
			sendJson(response, 403, { error: "Wsparcie przelewem jest obecnie wyłączone." });
			return;
		}
		const reference = crypto.randomBytes(4).toString("hex").toUpperCase();
		sendJson(response, 200, {
			holder: settings.holder,
			iban: settings.iban,
			amountGrosze: Math.round(amount * 100),
			currency: "PLN",
			title: `Wsparcie GLUSHAK DRIVE ${reference}`,
		});
		return;
	}

	const workDeleteMatch = url.pathname.match(/^\/api\/works\/([0-9a-f-]{36})$/i);
	if (url.pathname === "/api/works" || workDeleteMatch) {
		if (url.pathname === "/api/works" && request.method === "GET") {
			const works = readRows(worksPath, "works")
				.filter((work) => typeof work.id === "string"
					&& typeof work.title === "string"
					&& typeof work.videoId === "string"
					&& /^[A-Za-z0-9_-]{11}$/.test(work.videoId)
					&& typeof work.createdAt === "string")
				.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
				.map(({ id, title, videoId, createdAt }) => ({ id, title, videoId, createdAt }));
			sendJson(response, 200, { works });
			return;
		}
		const user = getCurrentUser(request);
		if (!canManage(user)) {
			sendJson(response, user ? 403 : 401, { error: "Tylko administrator może zarządzać pracami." });
			return;
		}
		if (url.pathname === "/api/works" && request.method === "POST") {
			let body;
			try {
				body = await readJsonBody(request);
			} catch (error) {
				sendJson(response, error.status || 400, { error: error.message });
				return;
			}
			const title = typeof body?.title === "string" ? body.title.trim() : "";
			const videoId = youtubeVideoId(body?.url);
			if (title.length < 2 || title.length > 100 || !videoId) {
				sendJson(response, 400, { error: "Podaj tytuł (2–100 znaków) i prawidłowy link do filmu YouTube." });
				return;
			}
			const work = { id: crypto.randomUUID(), title, videoId, createdAt: new Date().toISOString() };
			try {
				const works = readRows(worksPath, "works");
				works.push(work);
				writeRows(worksPath, "works", works);
			} catch {
				sendJson(response, 500, { error: "Nie udało się zapisać pracy." });
				return;
			}
			sendJson(response, 201, { work });
			return;
		}
		if (workDeleteMatch && request.method === "DELETE") {
			try {
				const works = readRows(worksPath, "works");
				const remainingWorks = works.filter((work) => work.id !== workDeleteMatch[1]);
				if (remainingWorks.length === works.length) {
					sendJson(response, 404, { error: "Nie znaleziono pracy." });
					return;
				}
				writeRows(worksPath, "works", remainingWorks);
			} catch {
				sendJson(response, 500, { error: "Nie udało się usunąć pracy." });
				return;
			}
			sendJson(response, 200, { deleted: true });
			return;
		}
		sendJson(response, 405, { error: "Method not allowed" });
		return;
	}

	if (url.pathname === "/api/comments") {
		if (request.method === "GET") {
			try {
				const user = getCurrentUser(request);
				const adminEmails = user?.role === "admin"
					? new Map(readAccounts().users.map((account) => [account.id, account.email]))
					: null;
				const comments = readCleanComments()
					.slice(-100)
					.reverse()
					.map(({ id, userId, name, message, createdAt }) => ({
						id,
						name,
						message,
						createdAt,
						...(adminEmails ? { email: adminEmails.get(userId) || null } : {}),
					}));
				sendJson(response, 200, { comments });
			} catch (error) {
				console.error("Nie udało się wczytać ani oczyścić komentarzy.", error);
				sendJson(response, 500, { error: "Nie udało się wczytać komentarzy." });
			}
			return;
		}
		if (request.method !== "POST") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		const user = getCurrentUser(request);
		if (!user) {
			sendJson(response, 401, { error: "Zaloguj się, aby dodać komentarz." });
			return;
		}
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			sendJson(response, error.status || 400, { error: error.message });
			return;
		}
		const message = body && typeof body.message === "string" ? body.message.trim() : "";
		if (message.length < 2 || message.length > 1000) {
			sendJson(response, 400, { error: "Komentarz musi mieć od 2 do 1000 znaków." });
			return;
		}
		const comment = {
			id: crypto.randomUUID(),
			userId: user.id,
			name: user.name,
			message,
			createdAt: new Date().toISOString(),
		};
		try {
			const comments = readCleanComments();
			if (isInappropriateComment(message)) {
				sendJson(response, 400, { error: "Komentarz zawiera niedozwolone wulgaryzmy.", code: "inappropriate_content" });
				return;
			}
			comments.push(comment);
			writeRows(commentsPath, "comments", comments.slice(-5000));
		} catch {
			sendJson(response, 500, { error: "Nie udało się zapisać komentarza." });
			return;
		}
		sendJson(response, 201, {
			comment: { id: comment.id, name: comment.name, message: comment.message, createdAt: comment.createdAt },
		});
		return;
	}

	if (url.pathname === "/api/community/badges") {
		if (request.method !== "GET") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		const user = getCurrentUser(request);
		if (!user) {
			sendJson(response, 401, { error: "Zaloguj się, aby zobaczyć swoje odznaki." });
			return;
		}
		try {
			sendJson(response, 200, getCommunityBadges(user.id));
		} catch (error) {
			console.error("Nie udało się wczytać odznak społeczności.", error);
			sendJson(response, 500, { error: "Nie udało się wczytać odznak." });
		}
		return;
	}

	if (url.pathname === "/api/notifications") {
		if (request.method !== "GET") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		const user = getCurrentUser(request);
		if (!user) {
			sendJson(response, 401, { error: "Zaloguj się, aby zobaczyć powiadomienia." });
			return;
		}
		try {
			sendJson(response, 200, await getUserNotifications(user.id));
		} catch (error) {
			console.error("Nie udało się wczytać powiadomień użytkownika.", error);
			sendJson(response, 500, { error: "Nie udało się wczytać powiadomień." });
		}
		return;
	}

	if (url.pathname === "/api/notifications/read") {
		if (request.method !== "POST") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		const user = getCurrentUser(request);
		if (!user) {
			sendJson(response, 401, { error: "Zaloguj się, aby zarządzać powiadomieniami." });
			return;
		}
		try {
			await withEngagementLock(() => {
				const state = readEngagementState();
				const current = state.users[user.id];
				if (current && Array.isArray(current.notifications)) {
					current.notifications = current.notifications.map((notification) => ({ ...notification, read: true }));
					writeEngagementState(state);
				}
			});
			sendJson(response, 200, { updated: true });
		} catch (error) {
			console.error("Nie udało się oznaczyć powiadomień jako przeczytane.", error);
			sendJson(response, 500, { error: "Nie udało się zaktualizować powiadomień." });
		}
		return;
	}

	if (url.pathname === "/api/account") {
		if (request.method !== "GET") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		const user = getCurrentUser(request);
		if (!user) {
			sendJson(response, 401, { error: "Zaloguj się, aby otworzyć swoje konto." });
			return;
		}
		try {
			const [orders, orderCapacity] = await Promise.all([
				getStoredOrders(user.id),
				getWeeklyOrderCapacity(),
			]);
			orders.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
			const payments = readRows(paymentsPath, "payments")
				.filter((payment) => payment.userId === user.id)
				.sort((left, right) => right.date.localeCompare(left.date));
			sendJson(response, 200, {
				user: publicUser(user),
				orders,
				payments,
				orderCapacity,
				orderingEnabled: readOrderSettings().enabled,
			});
		} catch (error) {
			sendOrderStorageError(response, error, "Nie udało się wczytać konta i zamówień.");
		}
		return;
	}

	const messageImageMatch = url.pathname.match(/^\/api\/messages\/image\/([0-9a-f-]{36})$/i);
	if (messageImageMatch) {
		if (request.method !== "GET") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		try {
			const image = await withMessageStoreLock(() => {
				const accounts = readAccounts();
				const user = getCurrentUser(request, accounts);
				if (!user) return { status: 401 };
				const messages = pruneExpiredMessages();
				const message = messages.find((item) => item.imageId === messageImageMatch[1]
					&& (item.senderId === user.id || item.recipientId === user.id));
				if (!message || !["image/jpeg", "image/png"].includes(message.imageType)) return { status: 404 };
				try {
					return { status: 200, type: message.imageType, content: fs.readFileSync(messageImageFile(message.imageId)) };
				} catch (error) {
					if (error.code === "ENOENT") return { status: 404 };
					throw error;
				}
			});
			if (image.status !== 200) {
				sendJson(response, image.status, { error: image.status === 401 ? "Zaloguj się, aby korzystać z wiadomości." : "Nie znaleziono obrazu." });
				return;
			}
			response.writeHead(200, {
				"Content-Type": image.type,
				"Content-Length": image.content.length,
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
				"Content-Security-Policy": "default-src 'none'; sandbox",
			});
			response.end(image.content);
		} catch (error) {
			console.error("Nie udało się wczytać prywatnego obrazu z wiadomości.", error);
			sendJson(response, 500, { error: "Nie udało się wczytać obrazu." });
		}
		return;
	}

	if (url.pathname === "/api/messages") {
		const accounts = readAccounts();
		const user = getCurrentUser(request, accounts);
		if (!user) {
			sendJson(response, 401, { error: "Zaloguj się, aby korzystać z wiadomości." });
			return;
		}
		if (request.method === "GET") {
			try {
				const result = await withMessageStoreLock(() => {
					const retainedMessages = pruneExpiredMessages();
					const usersById = new Map(accounts.users.map((account) => [account.id, account]));
					const messages = retainedMessages
						.filter((message) => message.senderId === user.id || message.recipientId === user.id)
						.sort((left, right) => right.sentAt.localeCompare(left.sentAt))
						.slice(0, 100)
						.map((message) => ({
							id: message.id,
							message: message.message || "",
							imageUrl: message.imageId ? `/api/messages/image/${message.imageId}` : "",
							sentAt: message.sentAt,
							direction: message.senderId === user.id ? "sent" : "received",
							senderName: usersById.get(message.senderId)?.name || "Nieznany użytkownik",
							recipientName: usersById.get(message.recipientId)?.name || "Nieznany użytkownik",
							conversationId: message.senderId === user.id ? message.recipientId : message.senderId,
							conversationName: message.senderId === user.id
								? usersById.get(message.recipientId)?.name || "Nieznany użytkownik"
								: usersById.get(message.senderId)?.name || "Nieznany użytkownik",
						}));
					return { messages };
				});
				sendJson(response, 200, result);
			} catch (error) {
				console.error("Nie udało się wczytać prywatnych wiadomości.", error);
				sendJson(response, 500, { error: "Nie udało się wczytać wiadomości." });
			}
			return;
		}
		if (request.method !== "POST") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		let body;
		try {
			body = await readJsonBody(request, maxMessageRequestLength);
		} catch (error) {
			sendJson(response, error.status || 400, { error: error.message });
			return;
		}
		const email = body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
		const recipientId = typeof body?.recipientId === "string" ? body.recipientId : "";
		const messageText = body && typeof body.message === "string" ? body.message.trim() : "";
		let imageBuffer = null;
		let imageType = "";
		if (body?.image !== undefined) {
			const encodedImage = body.image?.data;
			if (typeof encodedImage !== "string" || encodedImage.length > Math.ceil(maxMessageImageBytes * 4 / 3) + 4
				|| !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedImage)) {
				sendJson(response, 400, { error: "Wybierz obraz JPG lub PNG." });
				return;
			}
			imageBuffer = Buffer.from(encodedImage, "base64");
			if (!imageBuffer.length || imageBuffer.length > maxMessageImageBytes
				|| imageBuffer.toString("base64") !== encodedImage) {
				sendJson(response, 400, { error: "Obraz przekracza limit 5 MB." });
				return;
			}
			try {
				imageType = inspectMessageImage(imageBuffer);
				if (body.image.mimeType !== imageType) throw new Error("Wybierz obraz JPG lub PNG.");
			} catch (error) {
				if (error.message.startsWith("Wybierz obraz") || error.message.startsWith("Obraz ma")) {
					sendJson(response, 400, { error: error.message });
					return;
				}
				sendJson(response, 400, { error: "Wybierz obraz JPG lub PNG." });
				return;
			}
		}
		if ((!recipientId && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254))
			|| (recipientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipientId))) {
			sendJson(response, 400, { error: "Wpisz prawidłowy e-mail znajomego." });
			return;
		}
		if ((!messageText && !imageBuffer) || messageText.length > 2000) {
			sendJson(response, 400, { error: "Wiadomość musi mieć od 1 do 2000 znaków." });
			return;
		}
		if ((!recipientId && email === user.email.toLowerCase()) || recipientId === user.id) {
			sendJson(response, 400, { error: "Nie możesz wysłać wiadomości do siebie." });
			return;
		}
		const recipient = accounts.users.find((account) => recipientId
			? account.id === recipientId
			: account.email.toLowerCase() === email);
		if (!recipient) {
			sendJson(response, 404, { error: "Nie znaleziono zarejestrowanego konta o tym adresie e-mail." });
			return;
		}
		if (imageBuffer) {
			let image;
			try {
				image = decodeMessageImage(imageBuffer, imageType);
			} catch {
				sendJson(response, 400, { error: "Wybierz obraz JPG lub PNG." });
				return;
			}
			try {
				if (await classifyMessageImage(image)) {
					sendJson(response, 422, { error: "Obraz może zawierać niedozwolone treści i nie został wysłany." });
					return;
				}
			} catch (error) {
				console.error("Lokalna moderacja obrazu jest niedostępna.", error);
				sendJson(response, 503, { error: "Moderacja obrazu jest chwilowo niedostępna. Spróbuj ponownie później." });
				return;
			} finally {
				image.dispose();
			}
		}
		try {
			const message = await withMessageStoreLock(() => {
				const messages = pruneExpiredMessages();
				const created = {
					id: crypto.randomUUID(),
					senderId: user.id,
					recipientId: recipient.id,
					message: messageText,
					sentAt: new Date().toISOString(),
				};
				if (imageBuffer) {
					created.imageId = crypto.randomUUID();
					created.imageType = imageType;
				}
				try {
					if (imageBuffer) {
						fs.mkdirSync(messageUploadsPath, { recursive: true });
						fs.writeFileSync(messageImageFile(created.imageId), imageBuffer, { flag: "wx" });
					}
					messages.push(created);
					writeRows(messagesPath, "messages", messages);
				} catch (error) {
					if (created.imageId) removeMessageImage(created.imageId);
					throw error;
				}
				return created;
			});
			sendJson(response, 201, {
				message: {
					id: message.id,
					message: message.message,
					imageUrl: message.imageId ? `/api/messages/image/${message.imageId}` : "",
					sentAt: message.sentAt,
					direction: "sent",
					senderName: user.name,
					recipientName: recipient.name,
					conversationId: recipient.id,
					conversationName: recipient.name,
				},
			});
		} catch (error) {
			console.error("Nie udało się zapisać prywatnej wiadomości.", error);
			sendJson(response, 500, { error: "Nie udało się zapisać wiadomości." });
			return;
		}
		return;
	}

	if (url.pathname === "/api/orders/settings") {
		if (request.method === "GET") {
			try {
				sendJson(response, 200, readOrderSettings());
			} catch (error) {
				sendOrderStorageError(response, error, "Nie udało się wczytać ustawień zamówień.");
			}
			return;
		}
		if (request.method !== "POST") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		const user = getCurrentUser(request);
		if (!canManage(user)) {
			sendJson(response, user ? 403 : 401, { error: "Dostęp tylko dla administratora." });
			return;
		}
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			sendJson(response, error.status || 400, { error: error.message });
			return;
		}
		if (typeof body?.enabled !== "boolean") {
			sendJson(response, 400, { error: "Nieprawidłowe ustawienie widoczności zamówień." });
			return;
		}
		try {
			fs.writeFileSync(orderSettingsPath, JSON.stringify({ enabled: body.enabled }));
		} catch (error) {
			sendOrderStorageError(response, error, "Nie udało się zapisać ustawienia zamówień.");
			return;
		}
		sendJson(response, 200, { enabled: body.enabled });
		return;
	}

	if (url.pathname === "/api/orders" && request.method === "GET") {
		const user = getCurrentUser(request);
		if (!user) {
			sendJson(response, 401, { error: "Zaloguj się, aby sprawdzić zamówienia." });
			return;
		}
		try {
			let orders = await getStoredOrders(canManage(user) ? undefined : user.id);
			const usersById = new Map(readAccounts().users.map((account) => [account.id, account]));
			orders = orders
				.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
				.map((order) => ({
					...order,
					owner: canManage(user) ? publicUser(usersById.get(order.userId)) : undefined,
				}));
			sendJson(response, 200, { orders });
		} catch (error) {
			sendOrderStorageError(response, error, "Nie udało się wczytać zamówień.");
		}
		return;
	}

	if (url.pathname === "/api/orders/capacity" && request.method === "GET") {
		try {
			sendJson(response, 200, await getWeeklyOrderCapacity());
		} catch (error) {
			sendOrderStorageError(response, error, "Nie udało się sprawdzić tygodniowej dostępności zamówień.");
		}
		return;
	}

	if (url.pathname === "/api/orders" && request.method === "POST") {
		const user = getCurrentUser(request);
		if (!user) {
			sendJson(response, 401, { error: "Zaloguj się, aby złożyć zamówienie." });
			return;
		}
		try {
			if (!readOrderSettings().enabled) {
				sendJson(response, 403, { error: "Składanie zamówień jest obecnie wyłączone.", code: "ordering_disabled" });
				return;
			}
		} catch (error) {
			sendOrderStorageError(response, error, "Nie udało się sprawdzić ustawień zamówień.");
			return;
		}
		let body;
		try {
			body = await readJsonBody(request, maxOrderRequestLength);
		} catch (error) {
			sendJson(response, error.status || 400, { error: error.message });
			return;
		}
		const message = typeof body.message === "string" ? body.message.trim() : "";
		const quantity = Number(body.quantity ?? 1);
		if (message.length < 5 || message.length > 5000) {
			sendJson(response, 400, { error: "Wiadomość musi mieć od 5 do 5000 znaków." });
			return;
		}
		if (!Number.isInteger(quantity) || quantity < 1 || quantity > weeklyOrderLimit) {
			sendJson(response, 400, { error: "Ilość musi być liczbą całkowitą od 1 do 6.", code: "invalid_quantity" });
			return;
		}

		let attachment;
		if (body.attachment != null) {
			if (typeof body.attachment.name !== "string" || typeof body.attachment.data !== "string") {
				sendJson(response, 400, { error: "Nieprawidłowy załącznik." });
				return;
			}
			const encoded = body.attachment.data;
			if (encoded.length > Math.ceil(maxOrderAttachmentBytes * 4 / 3) + 8) {
				sendJson(response, 400, { error: "Plik musi mieć maksymalnie 100 MB." });
				return;
			}
			const content = Buffer.from(encoded, "base64");
			if (content.length > maxOrderAttachmentBytes || content.toString("base64") !== encoded) {
				sendJson(response, 400, { error: "Nieprawidłowy plik lub przekroczono limit 100 MB." });
				return;
			}
			attachment = {
				id: crypto.randomUUID(),
				name: safeDownloadName(body.attachment.name),
				size: content.length,
				type: typeof body.attachment.type === "string" ? body.attachment.type.slice(0, 100) : "application/octet-stream",
			};
			try {
				fs.mkdirSync(uploadsPath, { recursive: true });
				fs.writeFileSync(path.join(uploadsPath, attachment.id), content, { flag: "wx" });
			} catch {
				sendJson(response, 500, { error: "Nie udało się zapisać załącznika." });
				return;
			}
		}

		const order = {
			id: crypto.randomUUID(),
			userId: user.id,
			message,
			quantity,
			totalAmountGrosze: quantity * videoPriceGrosze,
			paymentStatus: "pending",
			status: "new",
			createdAt: new Date().toISOString(),
			attachment,
		};
		try {
			const saved = await saveOrderWithinCapacity(order);
			if (!saved.order) {
				if (attachment) fs.rmSync(path.join(uploadsPath, attachment.id), { force: true });
				sendJson(response, 409, {
					error: "Tygodniowy limit zamówień został osiągnięty lub ilość przekracza dostępne miejsca.",
					code: "weekly_capacity",
					remaining: saved.capacity.remaining,
				});
				return;
			}
			sendJson(response, 201, {
				order: saved.order,
				orderCapacity: saved.capacity,
				paymentInstructions: makeOrderPaymentInstructions(saved.order),
			});
			return;
		} catch (error) {
			if (attachment) fs.rmSync(path.join(uploadsPath, attachment.id), { force: true });
			if (String(error.details || error.message).includes("WEEKLY_ORDER_CAPACITY")) {
				try {
					const capacity = await getWeeklyOrderCapacity();
					sendJson(response, 409, {
						error: "Tygodniowy limit zamówień został osiągnięty lub ilość przekracza dostępne miejsca.",
						code: "weekly_capacity",
						remaining: capacity.remaining,
					});
				} catch (capacityError) {
					sendOrderStorageError(response, capacityError, "Nie udało się sprawdzić tygodniowej dostępności zamówień.");
				}
				return;
			}
			sendOrderStorageError(response, error, "Nie udało się zapisać zamówienia.");
			return;
		}
	}

	if (url.pathname === "/api/users" && request.method === "GET") {
		const user = getCurrentUser(request);
		if (!canManage(user)) {
			sendJson(response, user ? 403 : 401, { error: "Dostęp tylko dla administratora." });
			return;
		}
		const users = readAccounts().users.map(publicUser);
		sendJson(response, 200, { users });
		return;
	}

	if (url.pathname === "/api/payments" && request.method === "POST") {
		const user = getCurrentUser(request);
		if (!canManage(user)) {
			sendJson(response, user ? 403 : 401, { error: "Tylko administrator może dodawać opłaty." });
			return;
		}
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			sendJson(response, error.status || 400, { error: error.message });
			return;
		}
		const amount = Number(body.amount);
		const description = typeof body.description === "string" ? body.description.trim() : "";
		const status = ["paid", "pending", "cancelled"].includes(body.status) ? body.status : "pending";
		const date = typeof body.date === "string" ? body.date : "";
		if (!readAccounts().users.some((account) => account.id === body.userId)
			|| !Number.isFinite(amount) || amount <= 0 || amount > 1000000
			|| description.length < 2 || description.length > 160
			|| !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
			sendJson(response, 400, { error: "Sprawdź konto, kwotę, opis i datę opłaty." });
			return;
		}
		const payments = readRows(paymentsPath, "payments");
		const payment = {
			id: crypto.randomUUID(),
			userId: body.userId,
			amountGrosze: Math.round(amount * 100),
			currency: "PLN",
			description,
			status,
			date,
			createdAt: new Date().toISOString(),
		};
		try {
			payments.push(payment);
			writeRows(paymentsPath, "payments", payments);
		} catch {
			sendJson(response, 500, { error: "Nie udało się zapisać opłaty." });
			return;
		}
		sendJson(response, 201, { payment });
		return;
	}

	const orderStatusMatch = url.pathname.match(/^\/api\/orders\/([a-f0-9-]{36})\/status$/i);
	if (orderStatusMatch && request.method === "PATCH") {
		const user = getCurrentUser(request);
		if (!canManage(user)) {
			sendJson(response, user ? 403 : 401, { error: "Tylko administrator może zmieniać statusy zamówień." });
			return;
		}
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			sendJson(response, error.status || 400, { error: error.message });
			return;
		}
		if (!["new", "in-progress", "completed", "cancelled"].includes(body.status)) {
			sendJson(response, 400, { error: "Nieprawidłowy status zamówienia." });
			return;
		}
		try {
			const order = await updateStoredOrderStatus(orderStatusMatch[1], body.status);
			if (!order) {
				sendJson(response, 404, { error: "Nie znaleziono zamówienia." });
				return;
			}
			sendJson(response, 200, { order });
		} catch (error) {
			if (String(error.details || error.message).includes("WEEKLY_ORDER_CAPACITY")) {
				const capacity = error.capacity || await getWeeklyOrderCapacity();
				sendJson(response, 409, {
					error: "Przywrócenie zamówienia przekroczyłoby tygodniowy limit filmików.",
					code: "weekly_capacity",
					remaining: capacity.remaining,
				});
				return;
			}
			sendOrderStorageError(response, error, "Nie udało się zapisać statusu zamówienia.");
		}
		return;
	}

	const orderPaymentDetailsMatch = url.pathname.match(/^\/api\/orders\/([a-f0-9-]{36})\/payment-details$/i);
	if (orderPaymentDetailsMatch && request.method === "GET") {
		const user = getCurrentUser(request);
		if (!user) {
			sendJson(response, 401, { error: "Zaloguj się, aby zobaczyć dane do przelewu." });
			return;
		}
		try {
			const order = await findStoredOrder(orderPaymentDetailsMatch[1]);
			if (!order || order.userId !== user.id) {
				sendJson(response, 404, { error: "Nie znaleziono zamówienia." });
				return;
			}
			if (order.paymentStatus === "paid") {
				sendJson(response, 409, { error: "To zamówienie jest już oznaczone jako opłacone.", code: "already_paid" });
				return;
			}
			if (order.status === "cancelled") {
				sendJson(response, 409, { error: "Anulowane zamówienie nie wymaga płatności.", code: "order_cancelled" });
				return;
			}
			const paymentInstructions = makeOrderPaymentInstructions(order);
			if (!paymentInstructions) {
				sendJson(response, 503, { error: "Dane do przelewu nie są jeszcze skonfigurowane.", code: "payment_unconfigured" });
				return;
			}
			sendJson(response, 200, { paymentInstructions });
		} catch (error) {
			sendOrderStorageError(response, error, "Nie udało się wczytać danych do przelewu.");
		}
		return;
	}

	const orderPaymentStatusMatch = url.pathname.match(/^\/api\/orders\/([a-f0-9-]{36})\/payment-status$/i);
	if (orderPaymentStatusMatch && request.method === "PATCH") {
		const user = getCurrentUser(request);
		if (!canManage(user)) {
			sendJson(response, user ? 403 : 401, { error: "Tylko administrator może zmieniać status płatności." });
			return;
		}
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			sendJson(response, error.status || 400, { error: error.message });
			return;
		}
		if (!["pending", "paid", "cancelled"].includes(body.paymentStatus)) {
			sendJson(response, 400, { error: "Nieprawidłowy status płatności." });
			return;
		}
		try {
			const order = await updateStoredOrderPaymentStatus(orderPaymentStatusMatch[1], body.paymentStatus);
			if (!order) {
				sendJson(response, 404, { error: "Nie znaleziono zamówienia." });
				return;
			}
			sendJson(response, 200, { order });
		} catch (error) {
			sendOrderStorageError(response, error, "Nie udało się zapisać statusu płatności.");
		}
		return;
	}

	const orderFileMatch = url.pathname.match(/^\/api\/orders\/([a-f0-9-]{36})\/file$/i);
	if (orderFileMatch && request.method === "GET") {
		const user = getCurrentUser(request);
		if (!user) {
			sendJson(response, 401, { error: "Zaloguj się, aby pobrać plik." });
			return;
		}
		let order;
		try {
			order = await findStoredOrder(orderFileMatch[1]);
		} catch (error) {
			sendOrderStorageError(response, error, "Nie udało się wczytać zamówienia.");
			return;
		}
		if (!order || (order.userId !== user.id && !canManage(user))) {
			response.writeHead(404).end("Not found");
			return;
		}
		if (!order.attachment || !/^[a-f0-9-]{36}$/i.test(order.attachment.id)) {
			response.writeHead(404).end("Not found");
			return;
		}
		const contentPath = path.join(uploadsPath, order.attachment.id);
		fs.readFile(contentPath, (error, content) => {
			if (error) {
				response.writeHead(404).end("Not found");
				return;
			}
			const name = safeDownloadName(order.attachment.name);
			const fallbackName = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
			response.writeHead(200, {
				"Content-Type": "application/octet-stream",
				"Content-Length": content.length,
				"Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
				"X-Content-Type-Options": "nosniff",
				"Cache-Control": "private, no-store",
			});
			response.end(content);
		});
		return;
	}

	if (url.pathname === "/api/track") {
		if (request.method !== "POST") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}

		let bodyText = "";
		for await (const chunk of request) {
			bodyText += chunk;
			if (bodyText.length > 2048) {
				sendJson(response, 413, { error: "Request too large" });
				return;
			}
		}

		let body;
		try {
			body = JSON.parse(bodyText);
		} catch {
			sendJson(response, 400, { error: "Invalid JSON" });
			return;
		}

		const validSession = typeof body.session === "string" && /^[a-f0-9-]{36}$/i.test(body.session);
		const validType = body.type === "pageview" || body.type === "click";
		const validTarget = ["TikTok", "Instagram", "YouTube"].includes(body.target);
		if (!validSession || !validType || (body.type === "click" && !validTarget)) {
			sendJson(response, 400, { error: "Invalid event" });
			return;
		}

		let source = "Bezpośrednie";
		try {
			const referrer = typeof body.referrer === "string" && new URL(body.referrer.slice(0, 512));
			if (referrer && referrer.hostname !== "localhost" && referrer.hostname !== "127.0.0.1") {
				source = referrer.hostname.replace(/^www\./, "");
			}
		} catch {
			source = "Bezpośrednie";
		}

		const userAgent = request.headers["user-agent"] || "";
		const device = /ipad|tablet|android(?!.*mobile)/i.test(userAgent)
			? "Tablet"
			: /mobile|iphone|android/i.test(userAgent)
				? "Telefon"
				: "Komputer";
		const country = body.type === "pageview" ? getCountryCode(request.socket.remoteAddress) : undefined;
		const events = readEvents();
		events.push({
			timestamp: new Date().toISOString(),
			type: body.type,
			session: crypto.createHash("sha256").update(body.session).digest("hex"),
			path: "/",
			source: body.type === "pageview" ? source : undefined,
			device: body.type === "pageview" ? device : undefined,
			country,
			target: body.type === "click" ? body.target : undefined,
		});
		try {
			fs.writeFileSync(analyticsPath, JSON.stringify({ events: events.slice(-5000) }));
		} catch {
			sendJson(response, 500, { error: "Could not save analytics" });
			return;
		}

		sendJson(response, 202, { ok: true });
		return;
	}

	if (url.pathname === "/api/stats") {
		const user = getCurrentUser(request);
		if (!user) {
			sendJson(response, 401, { error: "Zaloguj się jako administrator." });
			return;
		}
		if (user.role !== "admin") {
			sendJson(response, 403, { error: "Dostęp tylko dla administratora." });
			return;
		}
		if (request.method !== "GET") {
			sendJson(response, 405, { error: "Method not allowed" });
			return;
		}
		sendJson(response, 200, summarize(readEvents()));
		return;
	}

	if (["/account", "/account.html", "/studio", "/studio.html"].includes(url.pathname)) {
		const user = getCurrentUser(request);
		if (!user) {
			response.writeHead(302, { Location: "/?auth=required" }).end();
			return;
		}
		if (url.pathname.startsWith("/studio") && user.role !== "admin") {
			response.writeHead(302, { Location: "/?auth=admin" }).end();
			return;
		}
	}

	const file = files[url.pathname];
	if (!file) {
		response.writeHead(404).end("Not found");
		return;
	}
	if (request.method !== "GET" && request.method !== "HEAD") {
		response.writeHead(405).end("Method not allowed");
		return;
	}

	fs.readFile(path.join(__dirname, file.name), (error, content) => {
		if (error) {
			response.writeHead(500).end("Could not load the page");
			return;
		}
		let responseContent = content;
		if (file.type.startsWith("text/html")) {
			const scriptNonce = crypto.randomBytes(18).toString("base64");
			response.setHeader("Content-Security-Policy", getContentSecurityPolicy(scriptNonce));
			responseContent = Buffer.from(content.toString("utf8").replace(/<script(?=[\s>])/gi, `<script nonce="${scriptNonce}"`));
		}
		response.writeHead(200, {
			"Content-Type": file.type,
			"Cache-Control": file.name === "analytics.js" ? "no-cache" : "no-store",
		});
		response.end(request.method === "HEAD" ? undefined : responseContent);
	});
}

const server = http.createServer((request, response) => {
	setSecurityHeaders(response);
	let pathname;
	try {
		pathname = new URL(request.url, "http://localhost").pathname;
	} catch {
		sendJson(response, 400, { error: "Nieprawidłowy adres żądania." });
		return;
	}
	if (!isSameOriginMutation(request, pathname)) {
		sendJson(response, 403, { error: "Żądanie spoza tej strony zostało zablokowane." });
		return;
	}
	if (enforceRequestRateLimit(request, response, pathname)) return;
	void handleRequest(request, response).catch(() => {
		if (!response.headersSent) response.writeHead(500);
		response.end("Internal server error");
	});
});
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.listen(port, host, () => {
	if (supabaseOrdersEnabled) {
		console.log("Order storage: Supabase.");
	} else {
		console.warn("Order storage: local orders.json (configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to use Supabase).");
	}
	console.log(`GLUSHAK DRIVE is running at http://${host}:${port}`);
});

setInterval(() => {
	void withMessageStoreLock(() => pruneExpiredMessages()).catch((error) => {
		console.error("Nie udało się usunąć wygasłych wiadomości i obrazów.", error);
	});
}, 60 * 60 * 1000).unref();