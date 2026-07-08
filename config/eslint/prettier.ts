import type { Linter } from "eslint";
import eslintPluginPrettier from "eslint-plugin-prettier";

const prettierConfig: Linter.Config = {
	plugins: { prettier: eslintPluginPrettier },
	rules: {
		"prettier/prettier": [
			"warn",
			{
				singleQuote: false,
				semi: true,
				bracketSpacing: true,
				bracketSameLine: true,
				useTabs: true,
				tabWidth: 4,
				printWidth: 140,
				trailingComma: "none",
				arrowParens: "always",
				endOfLine: "auto"
			},
			{ usePrettierrc: true }
		]
	}
};

export default prettierConfig;
