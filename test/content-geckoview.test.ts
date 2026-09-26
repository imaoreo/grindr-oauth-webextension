import { afterEach, describe, expect, test } from "vitest";

import { NATIVE_APP, TEXT } from "./support/extension-contract";
import { nativePayloads, tokenMessages } from "./support/fake-background";
import {
	closeOpenPages,
	openSignIn,
	readySignIn,
} from "./support/sign-in-flow";
import type { Tab } from "./support/sign-in-tab";
import { flush, waitFor } from "./support/waiting";

afterEach(closeOpenPages);

const target = "geckoview";

const clickSignIn = (tab: Tab) => tab.trustedClick(tab.ui.button);

const whenFailed = (tab: Tab) =>
	waitFor(
		() =>
			tab.ui.button.textContent === TEXT.tryAgain && !tab.ui.error.hidden,
		{ label: "failed state" },
	);

const expectFailedWith = ({ tab, message }: { tab: Tab; message: string }) => {
	const { ui } = tab;
	expect(ui.error.textContent).toBe(message);
	expect(ui.error.hidden).toBe(false);
	expect(ui.error.getAttribute("role")).toBe("alert");
	expect(ui.button.textContent).toBe(TEXT.tryAgain);
	expect(ui.button.disabled).toBe(false);
	expect(ui.find("token")).toBeNull();
	expect(ui.find("copy")).toBeNull();
	for (const token of tab.gis.tokensIssued) {
		expect(tab.html()).not.toContain(token);
	}
	expect(tab.alerts).toEqual([]);
	expect(tab.pageErrors).toEqual([]);
};

describe("geckoview content", () => {
	test("mounts on any web.grindr.com load without asking the background", async () => {
		const { extension, tab } = await readySignIn(target);
		expect(extension.messages).toEqual([]);
		expect(tab.injected.slice(0, 3)).toEqual([
			"shared/gis-core.js",
			"shared/apple-core.js",
			"shared/page-runner.js",
		]);
	});

	test("an accepted token goes to the background and the app and is never rendered", async () => {
		const { extension, tab } = await readySignIn(target, {
			native: "accept",
		});
		clickSignIn(tab);
		await waitFor(() => extension.dispatches.at(-1)?.replies.length === 1, {
			label: "delivery",
		});
		await flush(10);
		const [token] = tab.gis.tokensIssued;
		expect(tokenMessages(extension).map(({ message }) => message)).toEqual([
			{ type: "token", token },
		]);
		expect(nativePayloads(extension)).toEqual([
			{ app: NATIVE_APP, payload: { type: "token", token } },
		]);
		expect(extension.dispatches.at(-1)?.replies).toEqual([
			{ delivered: true },
		]);
		const { ui } = tab;
		expect(ui.error.hidden).toBe(true);
		expect(ui.find("token")).toBeNull();
		expect(tab.html()).not.toContain(token);
		expect(ui.button.textContent).toBe(TEXT.signingIn);
		expect(ui.button.disabled).toBe(true);
		expect(extension.tabUpdates).toEqual([]);
		expect(tab.alerts).toEqual([]);
	});

	test("a token the app rejects shows that the app didn't accept it", async () => {
		const { tab } = await readySignIn(target, { native: "refuse" });
		clickSignIn(tab);
		await whenFailed(tab);
		expectFailedWith({ tab, message: TEXT.refused });
	});

	test("a native bridge that throws synchronously shows that the app didn't accept the token", async () => {
		const { tab } = await readySignIn(target, { native: "throw" });
		clickSignIn(tab);
		await whenFailed(tab);
		expectFailedWith({ tab, message: TEXT.refused });
	});

	test("a silent app shows that it didn't answer at exactly 10000 ms, not at 9999 ms", async () => {
		const { extension, tab } = await readySignIn(target, {
			native: "silent",
		});
		clickSignIn(tab);
		await waitFor(() => extension.nativeCalls.length === 1, {
			label: "native call",
		});
		await flush(10);
		extension.backgroundClock.advance(9999);
		await flush(15);
		expect(tab.ui.error.hidden).toBe(true);
		expect(tab.ui.button.textContent).toBe(TEXT.signingIn);
		expect(tab.ui.button.disabled).toBe(true);
		extension.backgroundClock.advance(1);
		await whenFailed(tab);
		expectFailedWith({ tab, message: TEXT.noAnswer });
	});

	test("a second token is ignored while a delivery is pending", async () => {
		const { extension, tab } = await readySignIn(target, {
			native: "silent",
		});
		clickSignIn(tab);
		await waitFor(() => extension.nativeCalls.length === 1, {
			label: "native call",
		});
		tab.postResult({ token: "ya29.SECOND" });
		await flush(15);
		expect(extension.nativeCalls).toHaveLength(1);
		expect(tokenMessages(extension)).toHaveLength(1);
	});

	test("a background handler that throws shows that the token couldn't be handed to the app", async () => {
		const { extension, tab } = await readySignIn(target);
		extension.faults.getManifestThrows = true;
		clickSignIn(tab);
		await whenFailed(tab);
		expectFailedWith({ tab, message: TEXT.deliveryFailed });
		expect(extension.nativeCalls).toEqual([]);
	});

	for (const [label, reply] of [
		["undefined", undefined],
		["{delivered: false} without an error", { delivered: false }],
		["an empty object", {}],
	] as const) {
		test(`a background reply of ${label} shows that the token couldn't be handed to the app`, async () => {
			const { tab } = await readySignIn(target);
			tab.context.sendMessageOverride = (message) =>
				Promise.resolve(message?.type === "token" ? reply : {});
			clickSignIn(tab);
			await whenFailed(tab);
			expectFailedWith({ tab, message: TEXT.deliveryFailed });
		});
	}

	test("sendMessage throwing synchronously while the extension is alive shows that error", async () => {
		const { tab } = await readySignIn(target);
		tab.context.sendMessageOverride = () => {
			throw new Error("sync failure");
		};
		clickSignIn(tab);
		await whenFailed(tab);
		expectFailedWith({ tab, message: "sync failure" });
	});

	test("sendMessage rejecting while the extension is alive shows that error", async () => {
		const { tab } = await readySignIn(target);
		const unreachable =
			"Could not establish connection. Receiving end does not exist.";
		tab.context.sendMessageRejects = unreachable;
		clickSignIn(tab);
		await whenFailed(tab);
		expectFailedWith({ tab, message: unreachable });
	});

	test("an invalidated extension context asks to reload the page", async () => {
		const { extension, tab } = await readySignIn(target);
		tab.context.state = "invalidated";
		clickSignIn(tab);
		await whenFailed(tab);
		expectFailedWith({ tab, message: TEXT.extensionGone });
		expect(extension.nativeCalls).toEqual([]);
	});

	test("a sign-in failure after the extension context is invalidated shows an inline error without an uncaught exception", async () => {
		const { extension, tab } = await readySignIn(target, {
			gis: ["denied"],
		});
		tab.context.state = "invalidated";
		clickSignIn(tab);
		await whenFailed(tab);
		await flush(10);
		expectFailedWith({
			tab,
			message: "Sign-in failed: GIS returned no access_token",
		});
		expect(extension.nativeCalls).toEqual([]);
	});

	test("a sign-in failure is shown inline and reported to the app without waiting for it", async () => {
		const { extension, tab } = await readySignIn(target, {
			native: "silent",
			gis: ["popup_failed_to_open", "denied"],
		});
		await tab.clickUntilReadyAgain(tab.ui.button);
		clickSignIn(tab);
		await whenFailed(tab);
		expectFailedWith({
			tab,
			message: "Sign-in failed: GIS returned no access_token",
		});
		await waitFor(() => extension.nativeCalls.length === 1, {
			label: "error report",
		});
		expect(nativePayloads(extension)).toEqual([
			{
				app: NATIVE_APP,
				payload: {
					type: "error",
					error: "GIS returned no access_token",
				},
			},
		]);
		await flush(5);
		expect(extension.dispatches.at(-1)?.replies).toEqual([{}]);
		expect(extension.backgroundClock.now).toBe(0);
	});

	test("retrying after a refusal clears the error and delivers the second token", async () => {
		const { extension, tab } = await readySignIn(target, {
			native: "refuse",
			gis: ["token", "pending"],
		});
		clickSignIn(tab);
		await whenFailed(tab);
		extension.faults.native = "accept";
		clickSignIn(tab);
		await waitFor(() => tab.ui.button.textContent === TEXT.signingIn, {
			label: "signing in",
		});
		expect(tab.ui.error.hidden).toBe(true);
		tab.gis.resolvePending("token");
		await waitFor(() => extension.nativeCalls.length === 2, {
			label: "second delivery",
		});
		await flush(10);
		expect(
			nativePayloads(extension).map(({ payload }) => payload?.token),
		).toEqual(tab.gis.tokensIssued);
		expect(tab.ui.error.hidden).toBe(true);
		expect(tab.ui.find("token")).toBeNull();
	});

	test("retrying after a timeout delivers the next token", async () => {
		const { extension, tab } = await readySignIn(target, {
			native: "silent",
		});
		clickSignIn(tab);
		await waitFor(() => extension.nativeCalls.length === 1, {
			label: "native call",
		});
		await flush(5);
		extension.backgroundClock.advance(10000);
		await whenFailed(tab);
		extension.faults.native = "accept";
		clickSignIn(tab);
		await waitFor(() => extension.nativeCalls.length === 2, {
			label: "second delivery",
		});
		await flush(10);
		expect(tab.ui.error.hidden).toBe(true);
	});

	test("a closed popup returns to ready with no error and no native traffic", async () => {
		const { extension, tab } = await readySignIn(target, {
			gis: ["popup_closed"],
		});
		await tab.clickUntilReadyAgain(tab.ui.button);
		expect(tab.gis.requests).toBe(1);
		expect(tab.ui.error.hidden).toBe(true);
		expect(extension.nativeCalls).toEqual([]);
		expect(extension.messages).toEqual([]);
	});

	test("a Google sign-in SDK that fails to load is shown inline and reported to the app", async () => {
		const { extension, tab } = await openSignIn(target, {
			gsiLoadFailures: 1,
		});
		await waitFor(() => tab.ui.button.textContent === TEXT.tryAgain, {
			label: "sdk failure",
		});
		expectFailedWith({
			tab,
			message: "Sign-in failed: GIS SDK failed to load",
		});
		await waitFor(() => extension.nativeCalls.length === 1, {
			label: "error report",
		});
		expect(nativePayloads(extension)[0]?.payload).toEqual({
			type: "error",
			error: "GIS SDK failed to load",
		});
	});

	test("a manifest that can't be read at token time falls back to showing the token in place", async () => {
		const { extension, tab } = await readySignIn(target);
		tab.context.state = "invalidated-manifest-throws";
		clickSignIn(tab);
		await tab.whenTokenShown();
		expect([tab.ui.token.textContent]).toEqual(tab.gis.tokensIssued);
		expect(extension.nativeCalls).toEqual([]);
	});
});
