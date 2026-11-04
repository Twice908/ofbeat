import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const envPath = path.join(frontendDirectory, ".env");
const outputPath = path.join(frontendDirectory, "JS", "config.js");
const required = process.argv.includes("--required");

function parseEnv(contents) {
	const values = {};
	for (const line of contents.split(/\r?\n/)) {
		const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
		if (!match || match[1].startsWith("#")) continue;
		let value = match[2];
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		} else {
			value = value.replace(/\s+#.*$/, "").trim();
		}
		values[match[1]] = value;
	}
	return values;
}

let fileValues = {};
try {
	fileValues = parseEnv(await readFile(envPath, "utf8"));
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}

const apiBaseUrl = (
	process.env.FE_API_BASE_URL ??
	fileValues.FE_API_BASE_URL ??
	""
).trim();
const razorpayKeyId = (
	process.env.FE_RAZORPAY_KEY_ID ??
	fileValues.FE_RAZORPAY_KEY_ID ??
	""
).trim();

if (required && (!apiBaseUrl || !razorpayKeyId)) {
	throw new Error(
		"FE_API_BASE_URL and FE_RAZORPAY_KEY_ID must be set in the environment or FE/.env.",
	);
}

if (apiBaseUrl) {
	let parsed;
	try {
		parsed = new URL(apiBaseUrl);
	} catch {
		throw new Error("FE_API_BASE_URL must be an absolute HTTP(S) URL.");
	}
	if (
		(parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
		parsed.origin !== apiBaseUrl.replace(/\/$/, "")
	) {
		throw new Error("FE_API_BASE_URL must be the API origin, without a path.");
	}
}

if (razorpayKeyId && !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(razorpayKeyId)) {
	throw new Error("FE_RAZORPAY_KEY_ID must be a Razorpay public Key ID.");
}

const config = { apiBaseUrl, razorpayKeyId };
await writeFile(
	outputPath,
	`window.OFFBEAT_CONFIG = Object.freeze(${JSON.stringify(config)});\n`,
	{ mode: 0o644 },
);
console.log(`Generated ${path.relative(frontendDirectory, outputPath)}.`);
