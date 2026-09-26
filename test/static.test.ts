import { describe, expect, test } from "vitest";

import {
	BROWSER_TARGETS,
	listRepositoryDirectory,
	readRepositoryFile,
	type Target,
	targetFiles,
	TARGETS,
	webAccessiblePaths,
} from "./support/extension-files";

type Oklch = { lightness: number; chroma: number; hue: number };

const oklchToRgb = ({ lightness, chroma, hue }: Oklch) => {
	const hueRadians = (hue * Math.PI) / 180;
	const labA = chroma * Math.cos(hueRadians);
	const labB = chroma * Math.sin(hueRadians);
	const long = (lightness + 0.3963377774 * labA + 0.2158037573 * labB) ** 3;
	const medium = (lightness - 0.1055613458 * labA - 0.0638541728 * labB) ** 3;
	const short = (lightness - 0.0894841775 * labA - 1.291485548 * labB) ** 3;
	const linearRgb = [
		4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
		-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
		-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
	];
	return linearRgb.map((channel) => {
		const clamped = Math.min(1, Math.max(0, channel));
		const srgb =
			clamped <= 0.0031308
				? 12.92 * clamped
				: 1.055 * clamped ** (1 / 2.4) - 0.055;
		return Math.round(srgb * 255);
	});
};

const parseOklch = (value: string) => {
	const match = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(
		value,
	);
	if (!match) throw new Error(`unparsed ${value}`);
	const [, lightness = "", percent, chroma = "", hue = ""] = match;
	return oklchToRgb({
		lightness: Number(lightness) / (percent ? 100 : 1),
		chroma: Number(chroma),
		hue: Number(hue),
	});
};

const hexChannels = (value: string) => {
	const hex = /#([0-9a-f]{6})\b/i.exec(value)?.[1];
	if (!hex) return null;
	return [0, 2, 4].map((start) =>
		Number.parseInt(hex.slice(start, start + 2), 16),
	);
};

type Declaration = { property: string; value: string };
type Rule = { selector: string; declarations: Declaration[] };

const parseDeclaration = (declaration: string): Declaration => {
	const colon = declaration.indexOf(":");
	return {
		property: declaration.slice(0, colon).trim(),
		value: declaration.slice(colon + 1).trim(),
	};
};

const parseCss = (css: string): Rule[] =>
	[
		...css
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.matchAll(/([^{}]+)\{([^{}]*)\}/g),
	].map(([, selector = "", body = ""]) => ({
		selector: selector.trim().replace(/\s+/g, " "),
		declarations: body
			.split(";")
			.map((declaration) => declaration.trim())
			.filter(Boolean)
			.map(parseDeclaration),
	}));

const oklchFallbackProblems = (rule: Rule) =>
	rule.declarations.flatMap(({ property, value }, index) => {
		if (!value.includes("oklch(")) return [];
		const where = `${rule.selector} { ${property} }`;
		const previous = rule.declarations[index - 1];
		if (!previous || previous.property !== property) {
			return [`${where} has no fallback`];
		}
		const fallback = hexChannels(previous.value);
		if (!fallback || previous.value.includes("oklch(")) {
			return [`${where} fallback is not hex: ${previous.value}`];
		}
		const problems: string[] = [];
		if (
			previous.value.replace(/#[0-9a-f]{6}/i, "X") !==
			value.replace(/oklch\([^)]*\)/, "X")
		) {
			problems.push(
				`${where} fallback shape differs: ${previous.value} vs ${value}`,
			);
		}
		const expected = parseOklch(value);
		const drift = Math.max(
			...expected.map((channel, i) =>
				Math.abs(channel - (fallback[i] ?? 0)),
			),
		);
		if (drift > 3) {
			problems.push(
				`${where} ${previous.value} is off from ${value} (rgb ${expected.join(",")}) by ${drift}`,
			);
		}
		return problems;
	});

describe("static", () => {
	for (const target of TARGETS) {
		test(`${target}: every file the manifest references exists`, () => {
			const { manifest, exists } = targetFiles(target);
			const background = manifest.background ?? {};
			const paths = new Set([
				...(manifest.content_scripts ?? []).flatMap((entry) => [
					...(entry.js ?? []),
					...(entry.css ?? []),
				]),
				...(background.service_worker
					? [background.service_worker]
					: []),
				...(background.scripts ?? []),
				...webAccessiblePaths(manifest),
				...Object.values(manifest.icons ?? {}),
			]);
			expect([...paths].filter((path) => !exists(path))).toEqual([]);
		});

		test(`${target}: the page scripts content.js injects are web accessible`, () => {
			const { manifest, source } = targetFiles(target);
			const declared =
				/PAGE_SCRIPTS\s*=\s*(\[[^\]]*\])/.exec(
					source("shared/content.js"),
				)?.[1] ?? "[]";
			const pageScripts = JSON.parse(
				declared.replace(/,\s*\]/, "]"),
			) as string[];
			const accessible = webAccessiblePaths(manifest);
			expect(pageScripts.length).toBeGreaterThan(0);
			for (const path of pageScripts) expect(accessible).toContain(path);
		});

		test(`${target}: token.html references only existing files`, () => {
			const { source, exists } = targetFiles(target);
			const references = [
				...source("shared/token.html").matchAll(
					/(?:src|href)="([^"]+)"/g,
				),
			].map(([, reference]) => `shared/${reference}`);
			expect(
				references.filter((reference) => !exists(reference)),
			).toEqual([]);
		});
	}

	test("only the geckoview manifest has geckoViewAddons and nativeMessaging", () => {
		const permissions = (target: Target) =>
			targetFiles(target).manifest.permissions ?? [];
		expect(permissions("geckoview")).toContain("geckoViewAddons");
		expect(permissions("geckoview")).toContain("nativeMessaging");
		for (const target of BROWSER_TARGETS) {
			expect(permissions(target)).not.toContain("geckoViewAddons");
			expect(permissions(target)).not.toContain("nativeMessaging");
		}
	});

	test("nothing in shared/ or the manifests references token.css", () => {
		const files = [
			...listRepositoryDirectory("shared").map(
				(name) => `shared/${name}`,
			),
			...TARGETS.map((target) => `${target}/manifest.json`),
		];
		expect(
			files.filter((path) =>
				readRepositoryFile(path).includes("token.css"),
			),
		).toEqual([]);
	});

	test("every oklch() color has a matching hex fallback right before it", () => {
		const rules = parseCss(readRepositoryFile("shared/oauth-ui.css"));
		const oklchCount = rules
			.flatMap((rule) => rule.declarations)
			.filter(({ value }) => value.includes("oklch(")).length;
		expect(oklchCount).toBeGreaterThan(0);
		expect(rules.flatMap(oklchFallbackProblems)).toEqual([]);
	});

	test("the overlay scrolls, the card centers with margin:auto and the token is cut to 12ch with an ellipsis", () => {
		const rules = parseCss(readRepositoryFile("shared/oauth-ui.css"));
		const values = ({
			selector,
			property,
		}: {
			selector: string;
			property: string;
		}) =>
			rules
				.filter((rule) =>
					rule.selector
						.split(",")
						.map((part) => part.trim())
						.includes(selector),
				)
				.flatMap((rule) => rule.declarations)
				.filter((declaration) => declaration.property === property)
				.map((declaration) => declaration.value);
		expect(
			values({
				selector: ".grindr-oauth-overlay",
				property: "overflow-y",
			}),
		).toContain("auto");
		expect(
			values({ selector: ".grindr-oauth-card", property: "margin" }),
		).toContain("auto");
		expect(
			values({ selector: ".grindr-oauth-token", property: "max-width" }),
		).toContain("12ch");
		expect(
			values({
				selector: ".grindr-oauth-token",
				property: "text-overflow",
			}),
		).toContain("ellipsis");
	});
});
