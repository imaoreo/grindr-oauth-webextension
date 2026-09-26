(() => {
	"use strict";

	const RESULT_CHANNEL = "grindr-google-oauth:result";
	const START_CHANNEL = "grindr-google-oauth:start";
	const AWAITING_GESTURE = new Set(["popup_failed_to_open", "popup_closed"]);

	const postResult = (payload) => {
		try {
			window.postMessage(
				{ channel: RESULT_CHANNEL, ...payload },
				location.origin,
			);
		} catch {
			// best-effort notification
		}
	};

	const gis = () => window.__grindrGis;
	const apple = () => window.__grindrApple;

	let prepared = false;
	let loading = false;
	let running = false;

	const preload = () => {
		if (prepared || loading || !gis()) return;
		loading = true;
		postResult({ phase: "loading" });
		gis()
			.loadGisSdk()
			.then(
				() => {
					loading = false;
					prepared = true;
					postResult({ phase: "ready" });
				},
				(error) => {
					loading = false;
					postResult({ error: String(error?.message || error) });
				},
			);
	};

	const signIn = async (provider) => {
		if (provider === "apple") {
			return { token: await apple().requestAuthorization(), provider };
		}
		return { token: await gis().requestAccessToken() };
	};

	const requestToken = async (provider = "google") => {
		if (running) return;
		if (!(provider === "apple" ? apple() : gis())) {
			postResult({
				error: `${provider === "apple" ? "Apple" : "GIS"} core not loaded`,
			});
			return;
		}
		running = true;
		postResult({ phase: "signing-in", provider });
		try {
			const result = await signIn(provider);
			running = false;
			postResult(result);
		} catch (error) {
			running = false;
			if (AWAITING_GESTURE.has(error?.code)) {
				postResult({ phase: "ready" });
				return;
			}
			postResult({ error: String(error?.message || error) });
		}
	};

	preload();

	const isStartMessage = (event) =>
		event.source === window &&
		event.origin === location.origin &&
		event.data?.channel === START_CHANNEL;

	window.addEventListener("message", (event) => {
		if (isStartMessage(event)) requestToken(event.data.provider);
	});

	const onButtonClick = (event) => {
		if (running || !event.isTrusted) return;
		const button = event.target?.closest?.(".grindr-oauth-button");
		if (!button) return;
		const provider = button.dataset?.provider || "google";
		if (provider === "apple" || prepared) requestToken(provider);
		else preload();
	};
	window.addEventListener("click", onButtonClick, true);
})();
