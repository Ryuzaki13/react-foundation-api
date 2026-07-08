import type { Linter } from "eslint";

const ignoresConfig: Linter.Config = {
	ignores: ["node_modules", "dist", "build", ".output", ".tanstack", "temp", "src/app/routeTree.gen.ts", "**/*.d.ts"]
};

export default ignoresConfig;
