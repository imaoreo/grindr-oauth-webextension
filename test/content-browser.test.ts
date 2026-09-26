import { afterEach, describe, expect, test } from "vitest";

import { SIGN_IN_URL, TEXT } from "./support/extension-contract";
import { BROWSER_TARGETS, type Target } from "./support/extension-files";
import {
	createExtension,
	DEFAULT_TAB_ID,
	messageTypes,
	tokenMessages,
} from "./support/fake-background";
import {
	closeOpenPages,
	openSignIn,
	readySignIn,
	type SignInOptions,
	track,
} from "./support/sign-in-flow";
import { openTab, type Tab } from "./support/sign-in-tab";
import { flush, waitFor } from "./support/waiting";

afterEach(closeOpenPages);

const deniedText = (target: Target) =>
	target === "chrome"
		? "Sign-in failed: access_denied"
		: "Sign-in failed: GIS returned no access_token";

const latestToken = (tab: Tab) => {
	const token = tab.gis.tokensIssued.at(-1);
	if (token === undefined) throw new Error("no token was issued");
	return token;
};

const signIn = async (tab: Tab) => {
	tab.trustedClick(tab.ui.button);
	await tab.whenTokenShown();
	return latestToken(tab);
};

const isGrindrOverlayActive = (tab: Tab) =>
	tab.document.documentElement.classList.contains("grindr-oauth-active");

const whenTryAgainShown = (tab: Tab) =>
	waitFor(() => tab.ui.button.textContent === TEXT.tryAgain, {
		label: "try again",
	});

const whenCopied = (tab: Tab) =>
	waitFor(() => tab.ui.copy.textContent === TEXT.copied, { label: "copied" });

const whenCopyFailed = (tab: Tab) =>
	waitFor(() => tab.ui.status.textContent === TEXT.copyFailed, {
		label: "copy failed",
	});

const expectTokenView = ({ tab, token }: { tab: Tab; token: string }) => {
	const { ui } = tab;
	expect(ui.title.tagName).toBe("H1");
	expect(ui.title.textContent).toBe(TEXT.tokenTitle);
	expect(ui.token.tagName).toBe("P");
	expect(ui.token.textContent).toBe(token);
	expect(ui.copy.tagName).toBe("BUTTON");
	expect(ui.copy.textContent).toBe(TEXT.copy);
	expect(ui.copy.getAttribute("type")).toBe("button");
	expect(ui.copy.classList.contains("grindr-oauth-button")).toBe(false);
	expect(ui.copy.closest(".grindr-oauth-button")).toBeNull();
	expect(ui.status.getAttribute("role")).toBe("status");
	expect(ui.status.textContent).toBe("");
	expect(ui.note.textContent).toBe(TEXT.note);
	expect(ui.note.querySelector("strong")?.textContent).toBe("Native Grind");
	expect(ui.find("button")).toBeNull();
	expect(ui.find("error")).toBeNull();
	expect(ui.card.classList.contains("grindr-oauth-token-card")).toBe(true);
	expect([...ui.card.children].map((child) => child.className)).toEqual([
		"grindr-oauth-token-title",
		"grindr-oauth-token",
		"grindr-oauth-token-copy",
		"grindr-oauth-token-status",
		"grindr-oauth-token-note",
	]);
	expect(tab.alerts).toEqual([]);
	expect(tab.pageErrors).toEqual([]);
};

for (const target of BROWSER_TARGETS) {
	describe(`${target} content, browser path`, () => {
		test("an unarmed tab is left untouched", async () => {
			const { extension, tab } = await openSignIn(target, { arm: false });
			await flush(15);
			expect(tab.ui.find("overlay")).toBeNull();
			expect(tab.document.querySelector("#grindr-root")).not.toBeNull();
			expect(isGrindrOverlayActive(tab)).toBe(false);
			expect(tab.injected).toEqual([]);
			expect(tab.windowStops).toBe(0);
			expect(extension.messages.map(({ message }) => message)).toEqual([
				{ type: "ready" },
			]);
		});

		test("an unarmed tab ignores results the page posts", async () => {
			const { extension, tab } = await openSignIn(target, { arm: false });
			await flush(15);
			tab.postResult({ phase: "ready" });
			tab.postResult({ error: "forged failure" });
			tab.postResult({ token: "ya29.forged-by-page-script" });
			await flush(15);
			expect(tab.ui.find("overlay")).toBeNull();
			expect(isGrindrOverlayActive(tab)).toBe(false);
			expect(tab.document.querySelector("#grindr-root")).not.toBeNull();
			expect(tab.html()).not.toContain("ya29.forged-by-page-script");
			expect(extension.messages.map(({ message }) => message)).toEqual([
				{ type: "ready" },
			]);
		});

		test("the tab is left untouched when the background can't be reached", async () => {
			const extension = createExtension({ target });
			await extension.armTab();
			const tab = track(
				openTab(extension, {
					sendMessageRejects:
						"Could not establish connection. Receiving end does not exist.",
				}),
			);
			await flush(15);
			expect(tab.ui.find("overlay")).toBeNull();
			expect(tab.document.querySelector("#grindr-root")).not.toBeNull();
		});

		test("the tab is left untouched when the extension context is gone before ready", async () => {
			const extension = createExtension({ target });
			await extension.armTab();
			const tab = track(openTab(extension, { context: "invalidated" }));
			await flush(15);
			expect(tab.ui.find("overlay")).toBeNull();
		});

		test("an armed tab mounts the overlay and injects the page scripts in order", async () => {
			const { tab } = await openSignIn(target);
			await waitFor(() => tab.ui.button, { label: "overlay" });
			expect(tab.windowStops).toBe(1);
			expect(tab.document.querySelector("#grindr-root")).toBeNull();
			expect(isGrindrOverlayActive(tab)).toBe(true);
			expect(
				tab.document
					.querySelector('meta[name="viewport"]')
					?.getAttribute("content"),
			).toBe("width=device-width, initial-scale=1");
			await tab.whenReady();
			expect(tab.ui.button.disabled).toBe(false);
			expect(tab.ui.error.hidden).toBe(true);
			expect(tab.injected.slice(0, 3)).toEqual([
				"shared/gis-core.js",
				"shared/apple-core.js",
				"shared/page-runner.js",
			]);
		});

		test("the token is shown in place without reaching the background or navigating", async () => {
			const { extension, tab } = await readySignIn(target);
			const token = await signIn(tab);
			expectTokenView({ tab, token });
			expect(tokenMessages(extension)).toEqual([]);
			expect(JSON.stringify(extension.messages)).not.toContain(token);
			expect(messageTypes(extension)).toEqual(["ready"]);
			expect(extension.tabUpdates).toEqual([
				{ id: DEFAULT_TAB_ID, url: SIGN_IN_URL },
			]);
			expect(tab.window.location.href).toBe(SIGN_IN_URL);
			expect(JSON.stringify([...extension.session])).not.toContain(token);
			expect(extension.nativeMessagingLookups).toBe(0);
			expect(tab.ui.token.textContent.length).toBeGreaterThan(100);
		});

		test("focus moves to the copy button when the token replaces the card", async () => {
			const { tab } = await readySignIn(target);
			await signIn(tab);
			expect(tab.document.activeElement).toBe(tab.ui.copy);
		});

		test("results posted after the token is shown are ignored", async () => {
			const { extension, tab } = await readySignIn(target);
			const token = await signIn(tab);
			tab.postResult({ token: "ya29.SECOND-TOKEN" });
			tab.postResult({ error: "late failure" });
			tab.postResult({ phase: "ready" });
			await flush(10);
			expectTokenView({ tab, token });
			expect(tab.html()).not.toContain("ya29.SECOND-TOKEN");
			expect(tab.html()).not.toContain("late failure");
			expect(messageTypes(extension)).toEqual(["ready"]);
		});

		test("clicking the token view never starts another sign-in", async () => {
			const { tab } = await readySignIn(target);
			await signIn(tab);
			expect(tab.gis.requests).toBe(1);
			tab.trustedClick(tab.ui.copy);
			tab.trustedClick(tab.ui.token);
			tab.trustedClick(tab.ui.title);
			await flush(15);
			expect(tab.gis.requests).toBe(1);
			expect(tab.gis.popups).toHaveLength(target === "chrome" ? 1 : 0);
		});

		test("reloading the armed tab shows the sign-in button again", async () => {
			const { extension, tab } = await readySignIn(target);
			await signIn(tab);
			await tab.close();
			const reloaded = track(openTab(extension));
			await reloaded.whenReady();
			expect(reloaded.ui.find("token")).toBeNull();
		});

		test("closing the armed tab disarms it", async () => {
			const { extension, tab } = await readySignIn(target);
			await signIn(tab);
			extension.removeTab(DEFAULT_TAB_ID);
			await flush();
			const next = track(openTab(extension));
			await flush(15);
			expect(next.ui.find("overlay")).toBeNull();
		});

		test("markup in a token is shown as text", async () => {
			const { tab } = await readySignIn(target);
			const markup = '<img src=x onerror="window.pwned=1">ya29.x';
			tab.postResult({ token: markup });
			await tab.whenTokenShown();
			expect(tab.ui.token.textContent).toBe(markup);
			expect(tab.document.querySelector("img")).toBeNull();
		});

		for (const [situation, state] of [
			["the extension context is invalidated", "invalidated"],
			[
				"the extension context is invalidated and the manifest can't be read",
				"invalidated-manifest-throws",
			],
			["the extension runtime is gone", "runtime-gone"],
		] as const) {
			test(`the token is still shown in place when ${situation}`, async () => {
				const { extension, tab } = await readySignIn(target);
				tab.context.state = state;
				const token = await signIn(tab);
				expectTokenView({ tab, token });
				expect(tokenMessages(extension)).toEqual([]);
			});
		}

		test("a sign-in failure after the extension context is gone shows an inline error without an uncaught exception", async () => {
			const { tab } = await readySignIn(target, { gis: ["denied"] });
			tab.context.state = "invalidated";
			tab.trustedClick(tab.ui.button);
			await whenTryAgainShown(tab);
			await flush(10);
			expect(tab.ui.error.textContent).toBe(deniedText(target));
			expect(tab.pageErrors).toEqual([]);
			expect(tab.alerts).toEqual([]);
		});

		test("a sign-in failure is shown inline and reported, never alerted", async () => {
			const { extension, tab } = await readySignIn(target, {
				gis: ["denied"],
			});
			tab.trustedClick(tab.ui.button);
			await waitFor(() => !tab.ui.error.hidden, {
				label: "inline error",
			});
			const { ui } = tab;
			expect(ui.error.textContent).toBe(deniedText(target));
			expect(ui.error.getAttribute("role")).toBe("alert");
			expect(ui.button.textContent).toBe(TEXT.tryAgain);
			expect(ui.button.disabled).toBe(false);
			expect(tab.alerts).toEqual([]);
			await waitFor(() => extension.messages.length === 2, {
				label: "error report",
			});
			expect(extension.messages[1]?.message).toEqual({
				type: "error",
				error: deniedText(target).replace("Sign-in failed: ", ""),
			});
			await flush();
			expect(extension.nativeMessagingLookups).toBe(0);
		});

		test("retrying after a failure clears the error and shows the token", async () => {
			const { tab } = await readySignIn(target, {
				gis: ["denied", "token"],
			});
			tab.trustedClick(tab.ui.button);
			await whenTryAgainShown(tab);
			tab.trustedClick(tab.ui.button);
			await tab.whenTokenShown();
			expectTokenView({ tab, token: latestToken(tab) });
			expect(tab.gis.tokensIssued).toHaveLength(1);
			expect(tab.gis.requests).toBe(2);
		});

		test("the error clears as soon as the retry starts", async () => {
			const { tab } = await readySignIn(target, {
				gis: ["denied", "pending"],
			});
			tab.trustedClick(tab.ui.button);
			await whenTryAgainShown(tab);
			tab.trustedClick(tab.ui.button);
			await waitFor(() => tab.ui.button.textContent === TEXT.signingIn, {
				label: "signing in",
			});
			expect(tab.ui.error.hidden).toBe(true);
			expect(tab.ui.error.textContent).toBe("");
			expect(tab.ui.button.disabled).toBe(true);
		});

		for (const [popup, outcome] of [
			["a closed popup", "popup_closed"],
			["a popup that fails to open", "popup_failed_to_open"],
		] as const) {
			test(`${popup} goes back to ready without an error or a report`, async () => {
				const { extension, tab } = await readySignIn(target, {
					gis: [outcome, "token"],
				});
				await tab.clickUntilReadyAgain(tab.ui.button);
				expect(tab.gis.requests).toBe(1);
				expect(tab.ui.error.hidden).toBe(true);
				expect(tab.ui.button.textContent).toBe(TEXT.signIn);
				expect(messageTypes(extension)).toEqual(["ready"]);
				expect(tab.alerts).toEqual([]);
				const token = await signIn(tab);
				expectTokenView({ tab, token });
			});
		}

		test("untrusted clicks don't start a sign-in", async () => {
			const { tab } = await readySignIn(target);
			tab.ui.button.dispatchEvent(
				new tab.window.MouseEvent("click", { bubbles: true }),
			);
			await flush(10);
			expect(tab.gis.requests).toBe(0);
		});

		test("a page script that fails to inject is reported inline", async () => {
			const { tab } = await openSignIn(target, {
				injectFails: "shared/gis-core.js",
			});
			await waitFor(() => !tab.ui.error.hidden, {
				label: "inject error",
			});
			expect(tab.ui.error.textContent).toBe(
				"Sign-in failed: failed to inject shared/gis-core.js",
			);
			expect(tab.ui.button.textContent).toBe(TEXT.tryAgain);
			expect(tab.alerts).toEqual([]);
		});

		if (target === "firefox") {
			test("a Google sign-in SDK that fails to load is reported inline and Try again reloads it", async () => {
				const { tab } = await openSignIn(target, {
					gsiLoadFailures: 1,
				});
				await whenTryAgainShown(tab);
				expect(tab.ui.error.textContent).toBe(
					"Sign-in failed: GIS SDK failed to load",
				);
				expect(tab.alerts).toEqual([]);
				tab.trustedClick(tab.ui.button);
				await tab.whenReady();
				expect(tab.ui.error.hidden).toBe(true);
				const token = await signIn(tab);
				expectTokenView({ tab, token });
			});
		}

		describe("copy", () => {
			const showToken = async (options: SignInOptions) => {
				const opened = await readySignIn(target, options);
				const token = await signIn(opened.tab);
				return { ...opened, token };
			};

			test("a successful clipboard write shows Copied, then resets after 2500 ms", async () => {
				const { tab, token } = await showToken({
					clipboard: "resolve",
				});
				tab.trustedClick(tab.ui.copy);
				await whenCopied(tab);
				expect(tab.clipboard.writes).toEqual([token]);
				expect(tab.clipboard.execCalls).toEqual([]);
				expect(tab.ui.status.textContent).toBe(TEXT.copiedStatus);
				expect(tab.ui.status.classList.contains("is-error")).toBe(
					false,
				);
				tab.uiClock.advance(2499);
				expect(tab.ui.copy.textContent).toBe(TEXT.copied);
				tab.uiClock.advance(1);
				expect(tab.ui.copy.textContent).toBe(TEXT.copy);
			});

			test("a rejected clipboard write falls back to copying the selected token", async () => {
				const { tab, token } = await showToken({
					clipboard: "reject",
					execCommand: "true",
				});
				tab.trustedClick(tab.ui.copy);
				await whenCopied(tab);
				expect(tab.clipboard.writes).toEqual([token]);
				expect(tab.clipboard.execCalls).toEqual([
					{ command: "copy", selection: token },
				]);
				expect(tab.ui.status.textContent).toBe(TEXT.copiedStatus);
			});

			for (const [failure, execCommand] of [
				["returns false", "false"],
				["throws", "throw"],
			] as const) {
				test(`when the clipboard rejects and execCommand ${failure}, the error shows and the token stays selected`, async () => {
					const { tab, token } = await showToken({
						clipboard: "reject",
						execCommand,
					});
					tab.trustedClick(tab.ui.copy);
					await whenCopyFailed(tab);
					expect(tab.ui.status.classList.contains("is-error")).toBe(
						true,
					);
					expect(tab.ui.copy.textContent).toBe(TEXT.copy);
					expect(tab.selection()).toBe(token);
				});
			}

			for (const [missing, clipboard] of [
				["navigator.clipboard", "missing-api"],
				["clipboard.writeText", "missing-writeText"],
			] as const) {
				test(`without ${missing}, copying the selected token works`, async () => {
					const { tab, token } = await showToken({
						clipboard,
						execCommand: "true",
					});
					tab.trustedClick(tab.ui.copy);
					await whenCopied(tab);
					expect(tab.clipboard.writes).toEqual([]);
					expect(tab.clipboard.execCalls).toEqual([
						{ command: "copy", selection: token },
					]);
				});

				test(`without ${missing} and with a failing copy command, the error shows and the token stays selected`, async () => {
					const { tab, token } = await showToken({
						clipboard,
						execCommand: "false",
					});
					tab.trustedClick(tab.ui.copy);
					await whenCopyFailed(tab);
					expect(tab.selection()).toBe(token);
				});
			}

			test("a successful copy after a failure clears the error state", async () => {
				const { tab } = await showToken({
					clipboard: "reject",
					execCommand: "false",
				});
				tab.trustedClick(tab.ui.copy);
				await waitFor(
					() => tab.ui.status.classList.contains("is-error"),
					{ label: "error" },
				);
				tab.clipboard.behavior.clipboard = "resolve";
				tab.trustedClick(tab.ui.copy);
				await whenCopied(tab);
				expect(tab.ui.status.classList.contains("is-error")).toBe(
					false,
				);
				expect(tab.ui.status.textContent).toBe(TEXT.copiedStatus);
			});

			test("copying twice keeps a single reset timer", async () => {
				const { tab } = await showToken({ clipboard: "resolve" });
				tab.trustedClick(tab.ui.copy);
				await whenCopied(tab);
				tab.uiClock.advance(2000);
				tab.trustedClick(tab.ui.copy);
				await flush();
				tab.uiClock.advance(600);
				expect(tab.ui.copy.textContent).toBe(TEXT.copied);
				tab.uiClock.advance(1900);
				expect(tab.ui.copy.textContent).toBe(TEXT.copy);
				expect(tab.uiClock.pending).toBe(0);
			});
		});

		describe("pagehide", () => {
			test("replaces the token with No token here and drops it from the page", async () => {
				const { tab } = await readySignIn(target);
				const token = await signIn(tab);
				tab.pagehide();
				const { ui } = tab;
				expect(ui.title.textContent).toBe(TEXT.missingTitle);
				expect(ui.status.textContent).toBe(TEXT.missingStatus);
				expect(ui.find("token")).toBeNull();
				expect(ui.find("copy")).toBeNull();
				expect(ui.find("note")).toBeNull();
				expect(tab.html()).not.toContain(token);
				expect(tab.document.documentElement.textContent).not.toContain(
					token,
				);
				expect(tab.selectionDetached()).toBe(true);
			});

			test("clears the pending Copied reset timer", async () => {
				const { tab } = await readySignIn(target, {
					clipboard: "resolve",
				});
				const token = await signIn(tab);
				tab.trustedClick(tab.ui.copy);
				await whenCopied(tab);
				tab.pagehide();
				expect(tab.uiClock.pending).toBe(0);
				tab.uiClock.advance(5000);
				tab.pagehide();
				expect(tab.ui.title.textContent).toBe(TEXT.missingTitle);
				expect(tab.html()).not.toContain(token);
			});

			test("after a failed copy removes the selected token", async () => {
				const { tab } = await readySignIn(target, {
					clipboard: "reject",
					execCommand: "false",
				});
				const token = await signIn(tab);
				tab.trustedClick(tab.ui.copy);
				await waitFor(() => tab.selection() === token, {
					label: "selection",
				});
				tab.pagehide();
				expect(tab.html()).not.toContain(token);
				expect(tab.selectionDetached()).toBe(true);
			});

			test("before any token keeps the sign-in overlay", async () => {
				const { tab } = await readySignIn(target);
				tab.pagehide();
				expect(tab.ui.button.textContent).toBe(TEXT.signIn);
			});
		});
	});
}
