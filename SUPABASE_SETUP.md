# Supabase orders setup

The application stores orders in Supabase when both server environment variables are set. The service-role key is only read by Node.js and must never be added to browser code or committed to the project. Without both variables, the server uses the existing local `orders.json` storage.

The administrator can pause new orders in Studio under **Orders and payments → Order availability**. The choice is saved in the server's local `order-settings.json` file and is enforced by the order API; existing order history remains available. Keep this file on persistent server storage and out of source control.

## Public deployment security

The Node server binds to `127.0.0.1` by default. Keep it behind a maintained HTTPS reverse proxy, firewall, and operating-system updates; do not expose the Node port directly to the internet. If the application is intentionally bound to a non-loopback address, set `SECURE_COOKIES=true` and terminate HTTPS at the trusted proxy so session cookies use the `Secure` attribute. The server enforces same-origin checks on state-changing API requests, applies in-memory per-IP limits to login, registration, messaging, analytics, and other API writes, and sends browser security headers including a per-response nonce-based content security policy. These in-process limits reset on restart and are per server instance; configure additional rate limiting at the reverse proxy for a public or multi-instance deployment.

Keep `.env` files, `users.json`, `engagement.json`, order/payment settings, uploads, and backups private and outside version control. Use unique administrator passwords, keep server dependencies updated, restrict Studio access to trusted administrators, and maintain tested backups on persistent storage. No application-level measures can guarantee that a publicly exposed service will never be attacked.

## 1. Create the database table

1. Create a Supabase project.
2. Open **SQL Editor** in the Supabase dashboard.
3. Run [`supabase/schema.sql`](./supabase/schema.sql).

The schema creates the private `public.orders` table, indexes, and atomic RPC functions. It includes order quantity, the fixed price of PLN 20 per video, and a separate payment status. Row-level security is enabled and access is granted only to `service_role`. If you have already run an earlier version of this schema, run the updated SQL again to add the price and payment columns and refresh the order-creation function.

## 2. Set server environment variables

Copy the project URL and the `service_role` secret from the Supabase API settings. Configure them in the server's secret/environment-variable manager:

- `SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_SECRET`

Do not use the `anon` key here. Do not put either value in `account.html`, `studio.html`, or any browser JavaScript. Restart the Node server after configuring the variables. On startup, the server rejects a partial or invalid Supabase configuration.

## 3. Migrate existing orders

Back up `orders.json` and stop the Node server before migrating, so no order is submitted while the one-time import is in progress. In PowerShell, set the variables in the same terminal session used for the migration, then run:

```powershell
$env:SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_SERVICE_ROLE_SECRET"
npm run migrate:orders
```

The migration is safe to repeat: it upserts by order ID and processes batches of 100. Existing orders without a `quantity` are migrated as quantity 1. The script validates IDs, dates, and quantities before sending anything.

## 4. Weekly capacity and attachments

The ordering form displays remaining capacity for the current Monday-to-Sunday week (UTC). A new order reserves its requested number of videos immediately; cancelled orders release their capacity. Server-side database functions serialize bookings, so simultaneous requests cannot exceed six videos. Restoring a cancelled order is also checked against the cap.

Order records and attachment metadata are stored in Supabase. The total is calculated on the server at PLN 20 per video. Order attachments can be up to 100 MB; their actual bytes remain in the server's local `.uploads` directory. Keep that directory backed up and on persistent storage; migrating the JSON order records does not upload attachment contents to Supabase Storage. A customer can see bank transfer instructions only for their own order after signing in; the account details are managed in Studio under **Orders and payments → Bank account for transfers** and are shared with creator-support transfers. Changing the account also changes the instructions shown for pending orders. The administrator must update the payment status after verifying the transfer.

## 5. Private messages and image moderation

Private messages remain in the server's local `messages.json` file; images are stored in `.uploads/messages` and are served only to signed-in participants in the conversation. Messages older than 365 days are removed, with cleanup performed hourly and before message or image reads and sends. Keep both paths on persistent server storage and out of source control.

Chat images are limited to static JPEG and PNG files up to 5 MB. The server checks the actual file signature and image dimensions, then runs NSFWJS with TensorFlow.js locally before saving the image. Image bytes are not sent to an external moderation service. NSFWJS model weights may be fetched by the server when it moderates the first image after each restart; inference and image processing run locally. Uploads are rejected if moderation is unavailable. The classifier can make mistakes and cannot guarantee detection of every prohibited image.

## 6. Country analytics

After a visitor consents to analytics, the server uses the connecting IP address briefly with the local `geoip-lite` database to estimate a two-letter country code. It stores only that country code with the page-view event; it does not store the IP address or send it to a geolocation service. Country estimates can be unavailable or inaccurate, especially for VPNs, mobile networks, or visitors whose traffic reaches the server through a proxy. Older page views do not have country data. The updated consent notice is shown again because country estimation adds a new analytics field.

`geoip-lite` includes GeoLite data from MaxMind. MaxMind requires the database to be updated after installation. Create a free MaxMind account and license key, then in PowerShell set the key and run:

```powershell
$env:MAXMIND_LICENSE_KEY = "YOUR_MAXMIND_LICENSE_KEY"
Push-Location .\node_modules\geoip-lite
npm.cmd run updatedb -- license_key=$env:MAXMIND_LICENSE_KEY
Pop-Location
```

Refresh the database periodically using the same command. Do not commit the license key.

## 7. Notifications and community badges

In-page notifications track newly added works and changes to the signed-in user's order and payment statuses. Per-user read state and initial baselines are stored in the local `engagement.json` file; keep it on persistent server storage and out of source control. The first visit establishes a baseline and does not announce older works or order states. Community badges count comments linked to the user's account. New comments store the internal account ID, while the administrator-only Studio comments view resolves that ID to an email address. Older comments without an account ID do not reveal an email.

## 8. Verify

After configuring the variables and restarting the server, submit an order and verify it appears in the Supabase `orders` table. Check that the customer account and Studio can read it, update its status, and that remaining weekly capacity updates accordingly.
