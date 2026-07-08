import type { ESLint, Linter } from "eslint";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importPlugin, { createNodeResolver } from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const moduleResolverExtensions = [".ts", ".tsx", ".scss", ".js", ".mjs", ".cjs", ".json"];
const reactHooksPlugin = { rules: reactHooks.rules } satisfies ESLint.Plugin;
const reactRefreshPlugin = { rules: reactRefresh.rules } satisfies ESLint.Plugin;
const importXPlugin = { rules: importPlugin.rules } satisfies ESLint.Plugin;
const tsconfigRootDir = fileURLToPath(new URL("../..", import.meta.url));
const tsconfigPath = fileURLToPath(new URL("../../tsconfig.eslint.json", import.meta.url));

const globalConfig: Linter.Config = {
	files: ["src/**/*.{ts,tsx}"],
	languageOptions: {
		ecmaVersion: 2022,
		globals: {
			...globals.browser,
			...globals.node
		},
		parser: tseslint.parser,
		parserOptions: {
			ecmaVersion: "latest",
			ecmaFeatures: { jsx: true },
			sourceType: "module",
			project: [tsconfigPath],
			tsconfigRootDir
		}
	},
	plugins: {
		"react-hooks": reactHooksPlugin,
		"react-refresh": reactRefreshPlugin,
		"@typescript-eslint": tseslint.plugin,
		"import-x": importXPlugin
	},
	rules: {
		...(reactHooks.configs.recommended.rules as Linter.RulesRecord),
		"react-hooks/set-state-in-effect": "warn",
		"react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
		"@typescript-eslint/no-empty-object-type": "off",
		"import-x/no-unresolved": ["error", { ignore: ["\\?raw$"] }],
		"import-x/no-named-as-default-member": "warn",
		"import-x/no-cycle": "warn",
		"import-x/no-self-import": "error",
		"import-x/no-internal-modules": [
			"error",
			{
				forbid: ["**/internal/*"]
			}
		],
		"import-x/order": [
			"warn",
			{
				groups: ["external", "internal", "parent", "sibling", "object", "type", "index"],
				pathGroups: [
					{ pattern: "react", group: "external", position: "before" },
					{ pattern: "@/**", group: "internal", position: "before" },
					{ pattern: "**/*.{css,scss,sass,less}", group: "index", position: "before" }
				],
				pathGroupsExcludedImportTypes: ["react"],
				"newlines-between": "always",
				alphabetize: { order: "asc", caseInsensitive: true }
			}
		],
		"no-restricted-imports": [
			"error",
			{
				paths: [
					{
						name: "@/shared/api",
						message: "Импортируй из public API конкретного shared/api-модуля, например @/shared/api/async."
					},
					{
						name: "@/shared/config",
						message: "Импортируй из public API конкретного shared/config-модуля, например @/shared/config/theme."
					},
					{
						name: "@/shared/lib",
						message: "Импортируй из public API конкретного shared/lib-модуля, например @/shared/lib/formatters."
					},
					{
						name: "@/shared/ui",
						message: "Импортируй из public API конкретного shared/ui-модуля, например @/shared/ui/button."
					}
				],
				patterns: [
					{
						group: ["**/entities/*/*", "**/features/*/*", "**/widgets/*/*"],
						message: "Импортируй только из public API (index.ts) соседнего среза."
					}
				]
			}
		],

		"@typescript-eslint/naming-convention": [
			"warn",
			{
				selector: ["class", "interface", "typeAlias", "enum", "enumMember", "typeLike"],
				format: ["PascalCase"]
			},
			{
				selector: ["variable"],
				modifiers: ["default"],
				format: ["camelCase"],
				leadingUnderscore: "forbid",
				trailingUnderscore: "forbid"
			},
			{
				selector: ["function", "method"],
				format: ["camelCase"],
				leadingUnderscore: "forbid",
				trailingUnderscore: "forbid",
				filter: {
					regex: "^(use|[A-Z])",
					match: false
				}
			},
			{
				selector: "function",
				modifiers: ["exported"],
				filter: {
					regex: "^use[A-Z0-9].*$",
					match: true
				},
				format: ["camelCase"],
				leadingUnderscore: "forbid"
			},
			{
				selector: ["property", "parameterProperty"],
				format: null,
				leadingUnderscore: "forbid"
			},
			{
				selector: "parameter",
				format: ["camelCase"],
				leadingUnderscore: "allow"
			},
			{
				selector: "memberLike",
				format: ["camelCase"],
				leadingUnderscore: "allow"
			},
			{
				selector: ["objectLiteralProperty", "typeProperty"],
				format: null
			}
		],
		"@typescript-eslint/no-explicit-any": "warn"
	},
	settings: {
		"import-x/resolver-next": [
			createTypeScriptImportResolver({
				alwaysTryTypes: true,
				project: tsconfigPath
			}),
			createNodeResolver({
				extensions: moduleResolverExtensions
			})
		],
		"import/resolver": {
			typescript: {
				alwaysTryTypes: true,
				project: "./tsconfig.json"
			},
			node: {
				extensions: moduleResolverExtensions
			}
		}
	}
};
export default globalConfig;
