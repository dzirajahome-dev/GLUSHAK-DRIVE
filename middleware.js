function redirectToAdminLogin(request) {
	const destination = new URL("/", request.url);
	destination.searchParams.set("auth", "admin");
	return Response.redirect(destination, 302);
}

function sessionToken(request) {
	const cookie = request.headers.get("cookie") || "";
	const entry = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("glushak_session="));
	if (!entry) return "";
	try {
		return decodeURIComponent(entry.slice("glushak_session=".length));
	} catch {
		return "";
	}
}

export async function middleware(request) {
	const token = sessionToken(request);
	const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
	if (!token || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) || !serviceRoleKey) {
		return redirectToAdminLogin(request);
	}

	try {
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
		const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
		const headers = {
			apikey: serviceRoleKey,
			Authorization: `Bearer ${serviceRoleKey}`,
		};
		const sessionResponse = await fetch(
			`${supabaseUrl}/rest/v1/site_sessions?select=user_id&token_hash=eq.${tokenHash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
			{ headers, cache: "no-store" },
		);
		if (!sessionResponse.ok) return redirectToAdminLogin(request);
		const sessions = await sessionResponse.json();
		if (!Array.isArray(sessions) || !sessions[0]?.user_id) return redirectToAdminLogin(request);

		const userResponse = await fetch(
			`${supabaseUrl}/rest/v1/site_users?select=role&id=eq.${encodeURIComponent(sessions[0].user_id)}&limit=1`,
			{ headers, cache: "no-store" },
		);
		if (!userResponse.ok) return redirectToAdminLogin(request);
		const users = await userResponse.json();
		if (users[0]?.role !== "admin") return redirectToAdminLogin(request);
		return;
	} catch (error) {
		console.error("Could not verify the Studio session.", error);
		return redirectToAdminLogin(request);
	}
}

export const config = {
	matcher: ["/studio", "/studio.html"],
};
