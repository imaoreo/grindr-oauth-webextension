(() => {
	"use strict";

	const api = typeof browser !== "undefined" ? browser : chrome;
	const RESULT_CHANNEL = "grindr-oauth:result";
	const DELIVERY_FAILED = "Couldn't hand the token to the app.";
	const EXTENSION_GONE =
		"The extension was updated or turned off. Reload the page to sign in again.";
	const PAGE_SCRIPTS = [
		"shared/gis-core.js",
		"shared/apple-core.js",
		"shared/page-runner.js",
	];

	const injectPageScript = (path) =>
		new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = api.runtime.getURL(path);
			script.onload = () => {
				script.remove();
				resolve();
			};
			script.onerror = () =>
				reject(new Error(`failed to inject ${path}`));
			(document.head || document.documentElement).appendChild(script);
		});

	const injectPageScripts = async () => {
		for (const path of PAGE_SCRIPTS) {
			await injectPageScript(path);
		}
	};

	let mounted = false;
	let handled = false;

	const isGeckoViewBuiltIn = () => {
		try {
			return (api.runtime.getManifest().permissions || []).includes(
				"geckoViewAddons",
			);
		} catch {
			return false;
		}
	};

	const isExtensionAlive = () => {
		try {
			return Boolean(api.runtime?.id);
		} catch {
			return false;
		}
	};

	const sendMessage = (message) => {
		try {
			return Promise.resolve(api.runtime.sendMessage(message));
		} catch (error) {
			return Promise.reject(error);
		}
	};

	const fail = (message) => {
		handled = false;
		window.__grindrOauthUi.setPhase("failed");
		window.__grindrOauthUi.setError(message);
	};

	const handleToken = async (result) => {
		handled = true;
		const { token, provider } = result;
		if (!isGeckoViewBuiltIn()) {
			window.__grindrOauthUi.showToken(token, { focus: true, provider });
			return;
		}
		let delivery;
		try {
			delivery = await sendMessage({ type: "token", ...result });
		} catch (error) {
			fail(
				isExtensionAlive()
					? String(error?.message || error)
					: EXTENSION_GONE,
			);
			return;
		}
		if (delivery?.delivered) return;
		fail(delivery?.error || DELIVERY_FAILED);
	};

	const showError = (error) => {
		fail(`Sign-in failed: ${error}`);
		reportError(error);
	};

	const reportError = (error) => {
		sendMessage({ type: "error", error }).catch(() => {});
	};

	const isResultMessage = (event) =>
		event.source === window &&
		event.origin === location.origin &&
		event.data?.channel === RESULT_CHANNEL;

	window.addEventListener("message", (event) => {
		if (!mounted || !isResultMessage(event)) return;
		const { phase, provider, token, error } = event.data;
		if (phase) {
			window.__grindrOauthUi.setPhase(phase, provider);
			return;
		}
		if (handled) return;
		if (token) handleToken({ token, provider });
		else if (error) showError(error);
	});

	const runDesktop = async () => {
		mounted = true;
		window.stop();
		const head = document.createElement("head");
		const viewport = document.createElement("meta");
		viewport.name = "viewport";
		viewport.content = "width=device-width, initial-scale=1";
		head.append(viewport);
		document.documentElement.replaceChildren(
			head,
			document.createElement("body"),
		);
		window.__grindrOauthUi.mount();
		try {
			await injectPageScripts();
		} catch (error) {
			showError(String(error?.message || error));
		}
	};

	const main = async () => {
		if (isGeckoViewBuiltIn()) {
			await runDesktop();
			return;
		}
		let armed = false;
		try {
			armed = Boolean((await sendMessage({ type: "ready" }))?.armed);
		} catch {
			// no receiver; stay disarmed
		}
		if (armed) {
			await runDesktop();
		}
	};

	main();
})();
