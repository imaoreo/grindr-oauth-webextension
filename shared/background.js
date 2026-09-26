(() => {
	"use strict";

	const api = typeof browser !== "undefined" ? browser : chrome;
	const SIGN_IN_URL = "https://web.grindr.com/";
	const NATIVE_APP = "grindr_oauth";
	const NATIVE_ACK_TIMEOUT_MS = 10000;
	const NO_ANSWER = "The app didn't answer.";
	const REFUSED = "The app didn't accept the token.";
	const ARMED_KEY = "armedTabs";

	const sessionStore = api.storage?.session ?? null;
	const armedMemory = new Set();

	let queue = Promise.resolve();
	const serialize = (task) => {
		const result = queue.then(task, task);
		queue = result.then(
			() => {},
			() => {},
		);
		return result;
	};

	const armed = {
		add(tabId) {
			return serialize(async () => {
				if (!sessionStore) return void armedMemory.add(tabId);
				const { [ARMED_KEY]: ids = [] } =
					await sessionStore.get(ARMED_KEY);
				if (!ids.includes(tabId)) {
					await sessionStore.set({ [ARMED_KEY]: [...ids, tabId] });
				}
			});
		},
		has(tabId) {
			return serialize(async () => {
				if (!sessionStore) return armedMemory.has(tabId);
				const { [ARMED_KEY]: ids = [] } =
					await sessionStore.get(ARMED_KEY);
				return ids.includes(tabId);
			});
		},
		delete(tabId) {
			return serialize(async () => {
				if (!sessionStore) return void armedMemory.delete(tabId);
				const { [ARMED_KEY]: ids = [] } =
					await sessionStore.get(ARMED_KEY);
				await sessionStore.set({
					[ARMED_KEY]: ids.filter((id) => id !== tabId),
				});
			});
		},
	};

	const isGeckoViewBuiltIn = () =>
		(api.runtime.getManifest().permissions || []).includes(
			"geckoViewAddons",
		);

	const sendToNativeApp = (payload) =>
		new Promise((resolve) => {
			const timer = setTimeout(
				() => resolve({ delivered: false, error: NO_ANSWER }),
				NATIVE_ACK_TIMEOUT_MS,
			);
			const settle = (verdict) => {
				clearTimeout(timer);
				resolve(verdict);
			};
			const refuse = (error) => {
				console.error("[grindr-oauth] app refused", error);
				settle({ delivered: false, error: REFUSED });
			};
			try {
				api.runtime
					.sendNativeMessage(NATIVE_APP, payload)
					.then(() => settle({ delivered: true }), refuse);
			} catch (error) {
				refuse(error);
			}
		});

	const openSignInTab = async () => {
		const tab = await api.tabs.create({ url: "about:blank" });
		if (tab?.id === undefined) return;
		await armed.add(tab.id);
		await api.tabs.update(tab.id, { url: SIGN_IN_URL });
	};

	const tokenPayload = ({ token, provider }) =>
		provider === "apple"
			? { type: "token", token, provider }
			: { type: "token", token };

	const handleToken = async (message) => {
		if (!isGeckoViewBuiltIn()) return { delivered: false, error: REFUSED };
		return sendToNativeApp(tokenPayload(message));
	};

	const handleError = async (error) => {
		console.error("[grindr-oauth]", error);
		if (isGeckoViewBuiltIn()) sendToNativeApp({ type: "error", error });
		return {};
	};

	const actionApi = api.action || api.browserAction;
	if (actionApi?.onClicked) {
		actionApi.onClicked.addListener(openSignInTab);
	}

	if (api.tabs?.onRemoved) {
		api.tabs.onRemoved.addListener((tabId) => {
			armed.delete(tabId);
		});
	}

	const respond = (sendResponse, task, fallback) => {
		Promise.resolve()
			.then(task)
			.catch((error) => {
				console.error("[grindr-oauth]", error);
				return fallback;
			})
			.then(sendResponse);
		return true;
	};

	api.runtime.onMessage.addListener((message, sender, sendResponse) => {
		const tabId = sender?.tab?.id;
		switch (message?.type) {
			case "ready":
				return respond(
					sendResponse,
					async () => ({
						armed: tabId !== undefined && (await armed.has(tabId)),
					}),
					{ armed: false },
				);
			case "token":
				return respond(sendResponse, () => handleToken(message), {
					delivered: false,
				});
			case "error":
				return respond(
					sendResponse,
					() => handleError(message.error),
					{},
				);
			default:
				return undefined;
		}
	});
})();
