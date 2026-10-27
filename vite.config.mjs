import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const inputFiles = [
	"index.html",
	"account.html",
	"studio.html",
	"analytics.js",
	"account.js",
	"comments.js",
	"messages.js",
	"support.js",
	"works.js",
	"notifications.js",
	"community-badges.js",
	"i18n.js",
];

export default defineConfig({
	build: {
		rollupOptions: {
			input: Object.fromEntries(inputFiles.map((file) => [
				file.endsWith(".html") ? `page-${file}` : file.slice(0, -3),
				resolve(root, file),
			])),
			output: {
				entryFileNames: "[name].js",
			},
		},
	},
});
