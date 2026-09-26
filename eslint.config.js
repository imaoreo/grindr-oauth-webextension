import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import perfectionist from "eslint-plugin-perfectionist";
import globals from "globals";
import ts from "typescript-eslint";

const importOrder = [
	"error",
	{
		newlinesBetween: 0,
		groups: [
			["value-external", "value-builtin"],
			["type-external", "type-builtin"],
			{ newlinesBetween: 1 },
			"value-internal",
			"type-internal",
			[
				"value-parent",
				"value-sibling",
				"value-index",
				"type-parent",
				"type-sibling",
				"type-index",
			],
			"ts-equals-import",
			"unknown",
		],
	},
];

export default [
	{ ignores: ["web-ext-artifacts/"] },
	js.configs.recommended,
	prettier,
	{
		plugins: { perfectionist },
		linterOptions: { reportUnusedDisableDirectives: "error" },
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: { ...globals.browser, ...globals.webextensions },
		},
		rules: {
			eqeqeq: ["error", "always"],
			"perfectionist/sort-imports": importOrder,
			"perfectionist/sort-named-imports": "error",
			"max-lines": [
				"error",
				{ max: 600, skipBlankLines: true, skipComments: true },
			],
		},
	},
	...ts.configs.recommended.map((config) => ({
		...config,
		files: ["test/**/*.ts"],
	})),
];
