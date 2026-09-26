import { afterEach, describe, expect, test } from "vitest";

import { makeAccessToken } from "./support/access-tokens";
import { TEXT } from "./support/extension-contract";
import { TARGETS } from "./support/extension-files";
import { closeOpenPages, track } from "./support/sign-in-flow";
import { openTokenPage, type TokenPageOptions } from "./support/token-page";
import { waitFor } from "./support/waiting";

afterEach(closeOpenPages);

for (const target of TARGETS) {
	describe(`${target} token.html`, () => {
		const open = (
			hash: string | null,
			options: Omit<TokenPageOptions, "hash"> = {},
		) => track(openTokenPage(target, { hash, ...options }));

		test("the page loads only oauth-ui.css, oauth-ui.js and token.js, with no inline style or script", () => {
			const page = open(null);
			expect(page.references).toEqual([
				"oauth-ui.css",
				"oauth-ui.js",
				"token.js",
			]);
			expect(page.stylesheets).toEqual(["oauth-ui.css"]);
			expect(page.scripts).toEqual(["oauth-ui.js", "token.js"]);
			expect(page.inlineStyles).toBe(0);
		});

		test("a token in the hash is shown and the hash is cleared with replaceState", () => {
			const token = makeAccessToken();
			const page = open(token);
			const { ui } = page;
			expect(ui.title.textContent).toBe(TEXT.tokenTitle);
			expect(ui.token.textContent).toBe(token);
			expect(ui.copy.textContent).toBe(TEXT.copy);
			expect(ui.copy.classList.contains("grindr-oauth-button")).toBe(
				false,
			);
			expect(ui.status.getAttribute("role")).toBe("status");
			expect(ui.note.textContent).toBe(TEXT.note);
			expect(page.replaceCalls).toEqual([
				[null, "", "/shared/token.html"],
			]);
			expect(page.window.location.hash).toBe("");
			expect(page.window.location.href).not.toContain(token);
			expect(page.window.location.href).not.toContain("#");
		});

		test("a percent-encoded token is decoded", () => {
			const page = open(encodeURIComponent("ya29.a/b+c=d"));
			expect(page.ui.token.textContent).toBe("ya29.a/b+c=d");
		});

		for (const [label, hash] of [
			["an empty hash", ""],
			["no hash", null],
			["a garbled hash", "%E0%A4%A"],
		] as const) {
			test(`${label} shows No token here`, () => {
				const page = open(hash);
				const { ui } = page;
				expect(ui.title.textContent).toBe(TEXT.missingTitle);
				expect(ui.status.textContent).toBe(TEXT.missingStatus);
				expect(ui.find("token")).toBeNull();
				expect(ui.find("copy")).toBeNull();
				expect(page.window.location.hash).toBe("");
			});
		}

		test("markup in the hash is shown as text", () => {
			const markup = '<img src=x onerror="alert(1)">';
			const page = open(encodeURIComponent(markup));
			expect(page.ui.token.textContent).toBe(markup);
			expect(page.document.querySelector("img")).toBeNull();
		});

		test("when replaceState throws, the hash is cleared through location.hash", () => {
			const token = makeAccessToken();
			const page = open(token, { replaceStateThrows: true });
			expect(page.ui.token.textContent).toBe(token);
			expect(page.window.location.hash).toBe("");
		});

		test("pagehide replaces the token with No token here", () => {
			const token = makeAccessToken();
			const page = open(token);
			page.pagehide();
			expect(page.ui.title.textContent).toBe(TEXT.missingTitle);
			expect(page.html()).not.toContain(token);
		});

		test("copying the token works on the token page", async () => {
			const token = makeAccessToken();
			const page = open(token, { clipboard: "resolve" });
			page.ui.copy.click();
			await waitFor(() => page.ui.copy.textContent === TEXT.copied, {
				label: "copied",
			});
			expect(page.clipboard.writes).toEqual([token]);
			expect(page.ui.status.textContent).toBe(TEXT.copiedStatus);
		});

		test("a failed copy on the token page selects the token", async () => {
			const token = makeAccessToken();
			const page = open(token, {
				clipboard: "missing-api",
				execCommand: "false",
			});
			page.ui.copy.click();
			await waitFor(
				() => page.ui.status.textContent === TEXT.copyFailed,
				{ label: "failed" },
			);
			expect(page.selection()).toBe(token);
		});
	});
}
