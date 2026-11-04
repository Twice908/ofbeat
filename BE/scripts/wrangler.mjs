import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceConfig = path.join(projectDirectory, "wrangler.jsonc");
const generatedConfig = path.join(projectDirectory, ".wrangler.generated.json");
const args = process.argv.slice(2);
const needsRemoteDatabase =
	args[0] === "deploy" || (args[0] === "d1" && args.includes("--remote"));

let configPath = sourceConfig;
if (needsRemoteDatabase) {
	const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();
	const allowedOrigins = process.env.ALLOWED_ORIGINS?.trim();
	const sender = process.env.RESEND_FROM_EMAIL?.trim();
	if (!databaseId || !allowedOrigins) {
		throw new Error(
			"Set CLOUDFLARE_D1_DATABASE_ID and ALLOWED_ORIGINS before deploying or applying remote migrations.",
		);
	}
	for (const origin of allowedOrigins.split(",").map((value) => value.trim())) {
		let parsed;
		try {
			parsed = new URL(origin);
		} catch {
			throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
		}
		if (
			(parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
			parsed.origin !== origin
		) {
			throw new Error(`ALLOWED_ORIGINS must contain exact origins without paths: ${origin}`);
		}
	}
	const config = JSON.parse(await readFile(sourceConfig, "utf8"));
	config.d1_databases[0].database_id = databaseId;
	config.vars = {
		ALLOWED_ORIGINS: allowedOrigins,
		...(sender ? { RESEND_FROM_EMAIL: sender } : {}),
	};
	await writeFile(generatedConfig, `${JSON.stringify(config, null, 2)}\n`, {
		mode: 0o600,
	});
	configPath = generatedConfig;
}

const executable = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
const child = spawn(executable, ["--config", configPath, ...args], {
	cwd: projectDirectory,
	env: process.env,
	stdio: "inherit",
	shell: process.platform === "win32",
});

try {
	const exitCode = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (signal) reject(new Error(`Wrangler exited due to ${signal}.`));
			else resolve(code ?? 1);
		});
	});
	process.exitCode = exitCode;
} catch (error) {
	console.error(error instanceof Error ? error.message : "Wrangler failed.");
	process.exitCode = 1;
} finally {
	if (needsRemoteDatabase) {
		await rm(generatedConfig, { force: true });
	}
}
