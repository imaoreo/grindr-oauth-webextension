import { describe, expect, test } from "vitest";

import { makeAccessToken } from "./support/access-tokens";
import { NATIVE_APP, SIGN_IN_URL, TEXT } from "./support/extension-contract";
import { BROWSER_TARGETS, TARGETS } from "./support/extension-files";
import {
	createExtension,
	DEFAULT_TAB_ID,
	fromTab,
	type NativeMode,
	nativePayloads,
} from "./support/fake-background";
import { flush } from "./support/waiting";

const fromDefaultTab = fromTab(DEFAULT_TAB_ID);
const otherTabId = DEFAULT_TAB_ID + 1;
const ready = { type: "ready" };

for (const target of TARGETS) {
	describe(`${target} background`, () => {
		test("a ready message from an unarmed tab or without a sender tab is told it is not armed", async () => {
			const extension = createExtension({ target });
			for (const sender of [fromDefaultTab, {}, undefined]) {
				expect(
					await extension.dispatch({ message: ready, sender }).reply,
				).toEqual({ armed: false });
			}
		});

		test("messages of an unknown type are left unanswered", async () => {
			const extension = createExtension({ target });
			const unknown = extension.dispatch({
				message: { type: "nope" },
				sender: fromDefaultTab,
			});
			expect(unknown.returned).toBeUndefined();
			await flush();
			expect(unknown.replies).toEqual([]);
			expect(
				extension.dispatch({ message: null, sender: fromDefaultTab })
					.returned,
			).toBeUndefined();
		});

		test("an error report whose handler throws is still answered with an empty reply exactly once", async () => {
			const extension = createExtension({ target });
			extension.faults.getManifestThrows = true;
			const error = extension.dispatch({
				message: { type: "error", error: "boom" },
				sender: fromDefaultTab,
			});
			expect(error.returned).toBe(true);
			expect(await error.reply).toEqual({});
			await flush();
			extension.backgroundClock.advance(20000);
			await flush();
			expect(error.replies).toEqual([{}]);
		});

		test("a token whose handler throws is answered as not delivered exactly once", async () => {
			const extension = createExtension({ target });
			extension.faults.getManifestThrows = true;
			const token = extension.dispatch({
				message: { type: "token", token: makeAccessToken() },
				sender: fromDefaultTab,
			});
			expect(token.returned).toBe(true);
			expect(await token.reply).toEqual({ delivered: false });
			await flush();
			extension.backgroundClock.advance(20000);
			await flush();
			expect(token.replies).toHaveLength(1);
			expect(extension.nativeMessagingLookups).toBe(0);
		});
	});
}

for (const target of BROWSER_TARGETS) {
	describe(`${target} background, browser manifest`, () => {
		test("clicking the toolbar button opens a blank tab, arms it, then navigates it to the sign-in page", async () => {
			const extension = createExtension({ target });
			await extension.armTab();
			expect(extension.tabCreates).toEqual([{ url: "about:blank" }]);
			expect(extension.tabUpdates).toEqual([
				{ id: DEFAULT_TAB_ID, url: SIGN_IN_URL },
			]);
			const armed = extension.dispatch({
				message: ready,
				sender: fromDefaultTab,
			});
			expect(armed.returned).toBe(true);
			expect(await armed.reply).toEqual({ armed: true });
		});

		test("a failing storage.session read answers not armed exactly once and later reads recover", async () => {
			const extension = createExtension({ target });
			await extension.armTab();
			extension.faults.sessionGetRejects = true;
			const failed = extension.dispatch({
				message: ready,
				sender: fromDefaultTab,
			});
			expect(failed.returned).toBe(true);
			expect(await failed.reply).toEqual({ armed: false });
			await flush();
			expect(failed.replies).toEqual([{ armed: false }]);
			extension.faults.sessionGetRejects = false;
			const recovered = extension.dispatch({
				message: ready,
				sender: fromDefaultTab,
			});
			expect(await recovered.reply).toEqual({ armed: true });
			await flush();
			expect(recovered.replies).toHaveLength(1);
		});

		for (const [behavior, storage] of [
			["closing an armed tab disarms only that tab", "as-manifest"],
			[
				"without storage.session, armed tabs are kept in memory and closing one disarms only that tab",
				"absent",
			],
		] as const) {
			test(behavior, async () => {
				const extension = createExtension({ target, storage });
				await extension.armTab();
				await extension.armTab(otherTabId);
				extension.removeTab(DEFAULT_TAB_ID);
				await flush();
				expect(
					await extension.dispatch({
						message: ready,
						sender: fromDefaultTab,
					}).reply,
				).toEqual({ armed: false });
				expect(
					await extension.dispatch({
						message: ready,
						sender: fromTab(otherTabId),
					}).reply,
				).toEqual({ armed: true });
			});
		}

		test("a token message is refused and never forwarded, stored or navigated", async () => {
			const extension = createExtension({ target });
			await extension.armTab();
			const token = makeAccessToken();
			const refused = extension.dispatch({
				message: { type: "token", token },
				sender: fromDefaultTab,
			});
			expect(await refused.reply).toEqual({
				delivered: false,
				error: TEXT.refused,
			});
			await flush();
			extension.backgroundClock.advance(20000);
			await flush();
			expect(refused.replies).toHaveLength(1);
			expect(extension.nativeMessagingLookups).toBe(0);
			expect(extension.tabUpdates).toEqual([
				{ id: DEFAULT_TAB_ID, url: SIGN_IN_URL },
			]);
			expect(JSON.stringify([...extension.session])).not.toContain(token);
		});

		test("an error report gets an empty reply and never touches native messaging", async () => {
			const extension = createExtension({ target });
			const reply = extension.dispatch({
				message: { type: "error", error: "access_denied" },
				sender: fromDefaultTab,
			});
			expect(await reply.reply).toEqual({});
			expect(extension.nativeMessagingLookups).toBe(0);
		});

		test("the armed tab stays armed after a token message", async () => {
			const extension = createExtension({ target });
			await extension.armTab();
			await extension.dispatch({
				message: { type: "token", token: makeAccessToken() },
				sender: fromDefaultTab,
			}).reply;
			expect(
				await extension.dispatch({
					message: ready,
					sender: fromDefaultTab,
				}).reply,
			).toEqual({ armed: true });
		});
	});
}

describe("geckoview background, GeckoView manifest", () => {
	test("the GeckoView manifest has no toolbar button", () => {
		const { manifest } = createExtension({ target: "geckoview" });
		expect(manifest.action).toBeUndefined();
		expect(manifest.browser_action).toBeUndefined();
	});

	test("without a storage namespace the GeckoView background still delivers a token to the native app", async () => {
		const extension = createExtension({
			target: "geckoview",
			storage: "absent",
		});
		const token = makeAccessToken();
		const delivery = extension.dispatch({
			message: { type: "token", token },
			sender: fromDefaultTab,
		});
		expect(await delivery.reply).toEqual({ delivered: true });
		expect(nativePayloads(extension)).toEqual([
			{ app: NATIVE_APP, payload: { type: "token", token } },
		]);
	});
});

describe("geckoview background, native delivery", () => {
	const deliverToken = (native: NativeMode) => {
		const extension = createExtension({ target: "geckoview", native });
		const token = makeAccessToken();
		const delivery = extension.dispatch({
			message: { type: "token", token },
			sender: fromDefaultTab,
		});
		return { extension, token, delivery };
	};

	test("an accepted token is delivered to the native app as a token payload", async () => {
		const { extension, token, delivery } = deliverToken("accept");
		expect(await delivery.reply).toEqual({ delivered: true });
		expect(nativePayloads(extension)).toEqual([
			{ app: NATIVE_APP, payload: { type: "token", token } },
		]);
		expect(extension.backgroundClock.pending).toBe(0);
	});

	test("any native reply counts as delivered, even null", async () => {
		const { delivery } = deliverToken("accept-null");
		expect(await delivery.reply).toEqual({ delivered: true });
	});

	test("a native rejection reports that the app didn't accept the token", async () => {
		const { extension, delivery } = deliverToken("refuse");
		expect(await delivery.reply).toEqual({
			delivered: false,
			error: TEXT.refused,
		});
		expect(extension.backgroundClock.pending).toBe(0);
	});

	test("sendNativeMessage throwing synchronously reports that the app didn't accept the token", async () => {
		const { delivery } = deliverToken("throw");
		expect(await delivery.reply).toEqual({
			delivered: false,
			error: TEXT.refused,
		});
	});

	test("a missing sendNativeMessage reports that the app didn't accept the token", async () => {
		const { delivery } = deliverToken("missing");
		expect(await delivery.reply).toEqual({
			delivered: false,
			error: TEXT.refused,
		});
	});

	test("a silent app is reported as not answering at exactly 10000 ms, not at 9999 ms", async () => {
		const { extension, delivery } = deliverToken("silent");
		await flush();
		extension.backgroundClock.advance(9999);
		await flush();
		expect(delivery.replies).toEqual([]);
		extension.backgroundClock.advance(1);
		await flush();
		expect(delivery.replies).toEqual([
			{ delivered: false, error: TEXT.noAnswer },
		]);
	});

	test("a native reply after the timeout neither changes the verdict nor answers twice", async () => {
		const { extension, delivery } = deliverToken("silent");
		await flush();
		extension.backgroundClock.advance(10000);
		await flush();
		extension.nativeCalls[0]?.resolve(true);
		await flush();
		expect(delivery.replies).toEqual([
			{ delivered: false, error: TEXT.noAnswer },
		]);
	});

	test("a native reply at 9999 ms wins and clears the timeout", async () => {
		const { extension, delivery } = deliverToken("silent");
		await flush();
		extension.backgroundClock.advance(9999);
		extension.nativeCalls[0]?.resolve(true);
		await flush();
		extension.backgroundClock.advance(10);
		await flush();
		expect(delivery.replies).toEqual([{ delivered: true }]);
		expect(extension.backgroundClock.pending).toBe(0);
	});

	test("an error report is sent to the native app and answered without waiting for it", async () => {
		const extension = createExtension({
			target: "geckoview",
			native: "silent",
		});
		const reply = extension.dispatch({
			message: { type: "error", error: "access_denied" },
			sender: fromDefaultTab,
		});
		await flush();
		expect(reply.replies).toEqual([{}]);
		expect(extension.backgroundClock.now).toBe(0);
		expect(nativePayloads(extension)).toEqual([
			{
				app: NATIVE_APP,
				payload: { type: "error", error: "access_denied" },
			},
		]);
		extension.backgroundClock.advance(10000);
		await flush();
		expect(reply.replies).toEqual([{}]);
	});

	test("an error report is still answered when the native bridge throws", async () => {
		const extension = createExtension({
			target: "geckoview",
			native: "throw",
		});
		expect(
			await extension.dispatch({
				message: { type: "error", error: "x" },
				sender: fromDefaultTab,
			}).reply,
		).toEqual({});
	});
});

describe("geckoview background, Apple payloads", () => {
	test("an Apple code keeps only its provider; a Google token stays bare", async () => {
		const extension = createExtension({
			target: "geckoview",
			native: "accept",
		});
		const apple = extension.dispatch({
			message: {
				type: "token",
				token: "c0001.code",
				provider: "apple",
				idToken: "dropped",
			},
			sender: fromDefaultTab,
		});
		expect(await apple.reply).toEqual({ delivered: true });
		const token = makeAccessToken();
		const google = extension.dispatch({
			message: { type: "token", token, idToken: "dropped" },
			sender: fromDefaultTab,
		});
		expect(await google.reply).toEqual({ delivered: true });
		expect(nativePayloads(extension)).toEqual([
			{
				app: NATIVE_APP,
				payload: {
					type: "token",
					token: "c0001.code",
					provider: "apple",
				},
			},
			{ app: NATIVE_APP, payload: { type: "token", token } },
		]);
	});
});
