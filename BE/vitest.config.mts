import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
	const { readD1Migrations } = await import("@cloudflare/vitest-plugin");
	const migrations = await readD1Migrations("./migrations");

	return {
		define: {
			__D1_MIGRATIONS__: JSON.stringify(migrations),
		},
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./wrangler.jsonc" },
			}),
		],
	};
});
