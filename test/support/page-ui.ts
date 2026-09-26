import type { Window } from "happy-dom";

const PART_SELECTORS = {
	overlay: ".grindr-oauth-overlay",
	card: ".grindr-oauth-card",
	button: ".grindr-oauth-button",
	appleButton: ".grindr-oauth-button-apple",
	error: ".grindr-oauth-error",
	title: ".grindr-oauth-token-title",
	token: ".grindr-oauth-token",
	copy: ".grindr-oauth-token-copy",
	status: ".grindr-oauth-token-status",
	note: ".grindr-oauth-token-note",
} as const;

export type PagePart = keyof typeof PART_SELECTORS;

export const pageUi = (window: Window) => {
	const find = (part: PagePart) =>
		window.document.querySelector(PART_SELECTORS[part]);

	const element = (part: PagePart) => {
		const found = find(part);
		if (!(found instanceof window.HTMLElement)) {
			throw new Error(`the page shows no ${part}`);
		}
		return found;
	};

	const button = (part: PagePart) => {
		const found = find(part);
		if (!(found instanceof window.HTMLButtonElement)) {
			throw new Error(`the page shows no ${part} button`);
		}
		return found;
	};

	return {
		find,
		get overlay() {
			return element("overlay");
		},
		get card() {
			return element("card");
		},
		get button() {
			return button("button");
		},
		get appleButton() {
			return button("appleButton");
		},
		get error() {
			return element("error");
		},
		get title() {
			return element("title");
		},
		get token() {
			return element("token");
		},
		get copy() {
			return button("copy");
		},
		get status() {
			return element("status");
		},
		get note() {
			return element("note");
		},
	};
};

export type PageUi = ReturnType<typeof pageUi>;
