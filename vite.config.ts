import { createRequire } from "node:module";
import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

type PackageJson = {
	readonly name: string;
	readonly version: string;
	readonly peerDependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
};

const packageJson = require("./package.json") as PackageJson;

const externalPackages = Object.keys(packageJson.peerDependencies ?? {});
const missingPeerDevDependencies = externalPackages.filter((packageName) => packageJson.devDependencies?.[packageName] === undefined);

if (missingPeerDevDependencies.length > 0) {
	throw new Error(`Peer dependencies must also be present in devDependencies for local build: ${missingPeerDevDependencies.join(", ")}`);
}

function isExternalPackage(id: string): boolean {
	return externalPackages.some((packageName) => id === packageName || id.startsWith(`${packageName}/`));
}

export default defineConfig((configEnv) => ({
	define: {
		__APP_BUILD_ID__: JSON.stringify(import.meta.env.APP_BUILD_ID ?? `${packageJson.name}@${packageJson.version}`),
		__APP_ID__: JSON.stringify(import.meta.env.APP_ID ?? `${packageJson.name}@${packageJson.version}`),
		__DEV__: JSON.stringify(import.meta.env.DEV ?? configEnv.mode !== "production"),
		__PREVIEW__: "false",
		__SAP_CLIENT__: JSON.stringify("300"),
		__SSO_ORIGIN__: JSON.stringify("https://sso.some.site"),
		__ORIGIN_REG_EXP__: JSON.stringify("^https:\/\/sapbpc[a-z0-9-]+\.some\.site$"),
		__BASE_APP_CONFIG_URL__: JSON.stringify("/some/config")
	},
	build: {
		target: "es2022",
		sourcemap: true,
		emptyOutDir: true,
		copyPublicDir: false,
		lib: {
			entry: {
				"adt/index": resolve("src/adt/index.ts"),
				"async/index": resolve("src/async/index.ts"),
				"error-report/index": resolve("src/error-report/index.ts"),
				"http/index": resolve("src/http/index.ts"),
				"odata/index": resolve("src/odata/index.ts"),
				"persisted/index": resolve("src/persisted/index.ts"),
				"resource/index": resolve("src/resource/index.ts"),
				"server-fn/index": resolve("src/server-fn/index.ts"),
				"transport/index": resolve("src/transport/index.ts")
			},
			formats: ["es"]
		},
		rollupOptions: {
			external: isExternalPackage,
			output: {
				entryFileNames: "[name].js",
				chunkFileNames: "chunks/[name]-[hash].js",
				assetFileNames: "assets/[name][extname]"
			}
		}
	},
	test: {
		environment: "node",
		include: ["src/**/*.{test,spec}.{ts,tsx}"]
	}
}));
