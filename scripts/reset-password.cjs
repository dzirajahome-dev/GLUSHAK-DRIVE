const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");

const accountsPath = path.join(__dirname, "..", "users.json");

function ask(question) {
	const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => terminal.question(question, (answer) => {
		terminal.close();
		resolve(answer);
	}));
}

function askHidden(question) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("Uruchom to polecenie bezpośrednio w terminalu, aby hasło nie było widoczne.");
	}

	return new Promise((resolve, reject) => {
		let value = "";
		process.stdout.write(question);
		process.stdin.setRawMode(true);
		process.stdin.resume();
		const cleanup = () => {
			process.stdin.setRawMode(false);
			process.stdin.pause();
			process.stdin.removeListener("data", onData);
		};
		const onData = (input) => {
			for (const character of input.toString("utf8")) {
				if (character === "\u0003") {
					cleanup();
					process.stdout.write("\n");
					reject(new Error("Reset hasła anulowany."));
					return;
				}
				if (character === "\r" || character === "\n") {
					cleanup();
					process.stdout.write("\n");
					resolve(value);
					return;
				}
				if (character === "\u007f" || character === "\b") {
					value = value.slice(0, -1);
					continue;
				}
				if (character >= " " && character !== "\u007f") value += character;
			}
		};
		process.stdin.on("data", onData);
	});
}

async function main() {
	const email = (await ask("E-mail konta: ")).trim().toLowerCase();
	const password = await askHidden("Nowe hasło (min. 10 znaków): ");
	const confirmation = await askHidden("Powtórz nowe hasło: ");
	if (password.length < 10 || password.length > 256) {
		throw new Error("Hasło musi mieć od 10 do 256 znaków.");
	}
	if (password !== confirmation) throw new Error("Hasła nie są takie same.");

	const accounts = JSON.parse(fs.readFileSync(accountsPath, "utf8"));
	if (!accounts || !Array.isArray(accounts.users) || !Array.isArray(accounts.sessions)) {
		throw new Error("Plik users.json ma nieprawidłowy format; nie wprowadzono zmian.");
	}
	const user = accounts.users.find((item) => item.email === email);
	if (!user) throw new Error("Nie znaleziono konta z tym adresem e-mail.");

	user.salt = crypto.randomBytes(16).toString("hex");
	user.passwordHash = crypto.scryptSync(password, user.salt, 64).toString("hex");
	accounts.sessions = accounts.sessions.filter((session) => session.userId !== user.id);
	fs.writeFileSync(accountsPath, JSON.stringify(accounts));
	console.log("Hasło zostało zmienione. Zaloguj się nowym hasłem.");
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
