import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import globalConfig from "./config/eslint/global";
import ignoresConfig from "./config/eslint/ignores";
import prettierConfig from "./config/eslint/prettier";

export default defineConfig([
	ignoresConfig,
	tseslint.configs.recommended,
	globalConfig,
	{
		files: ["src/utils/cn.ts"],
		rules: {
			"prefer-rest-params": "off"
		}
	},
	prettierConfig
]);
