import { afterEach, describe, expect, test } from "vitest";

import { NATIVE_APP, TEXT } from "./support/extension-contract";
import { BROWSER_TARGETS } from "./support/extension-files";
import { nativePayloads, tokenMessages } from "./support/fake-background";
import { closeOpenPages, readySignIn } from "./support/sign-in-flow";
import type { Tab } from "./support/sign-in-tab";
import { flush, waitFor } from "./support/waiting";

afterEach(closeOpenPages);

const signInWithApple = (tab: Tab) => tab.trustedClick(tab.ui.appleButton);

const whenAppleFailed = (tab: Tab) =>
	waitFor(() => tab.ui.appleButton.textContent === TEXT.tryAgain, {
		label: "apple try again",
	});

for (const target of BROWSER_TARGETS) {
	describe(`${target} content, Sign in with Apple`, () => {
		test("the Apple button is ready next to the Google one", async () => {
			const { tab } = await readySignIn(target);
			expect(tab.ui.appleButton.textContent).toBe(TEXT.appleSignIn);
			expect(tab.ui.appleButton.disabled).toBe(false);
			expect(tab.ui.button.textContent).toBe(TEXT.signIn);
		});

		test("opens Apple's popup with Grindr Web's service ID, not Apple's SDK", async () => {
			const { tab } = await readySignIn(target, { apple: ["pending"] });
			signInWithApple(tab);
			await waitFor(() => tab.apple.popups.length === 1, {
				label: "apple popup",
			});
			const [{ url }] = tab.apple.popups;
			expect(url.origin + url.pathname).toBe(
				"https://appleid.apple.com/auth/authorize",
			);
			expect(Object.fromEntries(url.searchParams)).toMatchObject({
				client_id: "com.grindrguy.grindrx.signin",
				redirect_uri: "https://web.grindr.com/apple-login",
				response_type: "code id_token",
				response_mode: "web_message",
				scope: "email",
			});
			expect(url.searchParams.get("state")).toBeTruthy();
			expect(tab.injected.some((src) => src.includes("appleid"))).toBe(
				false,
			);
			await waitFor(
				() => tab.ui.appleButton.textContent === TEXT.appleSigningIn,
				{ label: "signing in with apple" },
			);
			expect(tab.ui.appleButton.disabled).toBe(true);
			expect(tab.ui.button.disabled).toBe(true);
			expect(tab.ui.button.textContent).toBe(TEXT.signIn);
		});

		test("shows only the code in place without reaching the background", async () => {
			const { extension, tab } = await readySignIn(target);
			signInWithApple(tab);
			await tab.whenTokenShown();
			const [code] = tab.apple.codesIssued;
			const { ui } = tab;
			expect(ui.title.textContent).toBe(TEXT.appleTitle);
			expect(ui.token.textContent).toBe(code);
			expect(ui.copy.textContent).toBe(TEXT.appleCopy);
			expect(ui.note.textContent).toBe(TEXT.appleNote);
			expect(
				tab.document.querySelectorAll(".grindr-oauth-token"),
			).toHaveLength(1);
			expect(tab.html()).not.toContain("eyJ");
			expect(tokenMessages(extension)).toEqual([]);
			expect(tab.apple.popups[0]?.popup.closed).toBe(true);
		});

		test("copy copies the code", async () => {
			const { tab } = await readySignIn(target);
			signInWithApple(tab);
			await tab.whenTokenShown();
			tab.trustedClick(tab.ui.copy);
			await waitFor(() => tab.clipboard.writes.length === 1, {
				label: "code copied",
			});
			expect(tab.clipboard.writes).toEqual([tab.apple.codesIssued[0]]);
		});

		for (const outcome of [
			"cancelled",
			"popup_closed",
			"popup_failed_to_open",
		] as const) {
			test(`${outcome} returns to the sign-in buttons without an error`, async () => {
				const { tab } = await readySignIn(target, { apple: [outcome] });
				await tab.clickUntilReadyAgain(tab.ui.appleButton);
				expect(tab.ui.error.hidden).toBe(true);
				expect(tab.ui.appleButton.textContent).toBe(TEXT.appleSignIn);
				expect(tab.ui.appleButton.disabled).toBe(false);
				expect(tab.ui.button.textContent).toBe(TEXT.signIn);
			});
		}

		test("an Apple error is shown and only the Apple button offers to try again", async () => {
			const { tab } = await readySignIn(target, {
				apple: ["invalid_client"],
			});
			signInWithApple(tab);
			await whenAppleFailed(tab);
			expect(tab.ui.error.textContent).toBe(
				"Sign-in failed: invalid_client",
			);
			expect(tab.ui.button.textContent).toBe(TEXT.signIn);
			expect(tab.ui.button.disabled).toBe(false);
		});

		test("ignores answers from other origins or for another request", async () => {
			const { tab } = await readySignIn(target, { apple: ["pending"] });
			signInWithApple(tab);
			await waitFor(() => tab.apple.popups.length === 1, {
				label: "apple popup",
			});
			const forged = {
				method: "oauthDone",
				data: {
					authorization: {
						code: "FORGED",
						state: tab.apple.lastState,
					},
				},
			};
			tab.apple.post(forged, "https://evil.example");
			tab.apple.post({
				method: "oauthDone",
				data: { authorization: { code: "STALE", state: "other" } },
			});
			await flush(10);
			expect(tab.ui.find("token")).toBeNull();
			expect(tab.ui.appleButton.textContent).toBe(TEXT.appleSigningIn);
			tab.apple.post(forged);
			await tab.whenTokenShown();
			expect(tab.ui.token.textContent).toBe("FORGED");
		});

		test("Google still signs in after an Apple attempt was cancelled", async () => {
			const { tab } = await readySignIn(target, { apple: ["cancelled"] });
			await tab.clickUntilReadyAgain(tab.ui.appleButton);
			tab.trustedClick(tab.ui.button);
			await tab.whenTokenShown();
			expect(tab.ui.title.textContent).toBe(TEXT.tokenTitle);
			expect(tab.ui.token.textContent).toBe(tab.gis.tokensIssued[0]);
		});
	});
}

describe("geckoview content, Sign in with Apple", () => {
	test("the code goes to the app tagged as Apple, without the ID token", async () => {
		const { extension, tab } = await readySignIn("geckoview", {
			native: "accept",
		});
		signInWithApple(tab);
		await waitFor(() => extension.nativeCalls.length === 1, {
			label: "native call",
		});
		await flush(10);
		const [code] = tab.apple.codesIssued;
		expect(nativePayloads(extension)).toEqual([
			{
				app: NATIVE_APP,
				payload: { type: "token", token: code, provider: "apple" },
			},
		]);
		expect(tab.ui.find("token")).toBeNull();
		expect(tab.html()).not.toContain(code);
	});
});
