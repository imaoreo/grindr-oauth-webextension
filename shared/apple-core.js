(() => {
	"use strict";

	// Talks to the appleid.apple.com popup directly instead of loading Apple's
	// JS SDK, so no remotely hosted code runs (Chrome MV3 rejects it). The
	// config is the one Grindr Web passes to AppleID.auth.init.

	if (window.__grindrApple) return;

	const DEFAULTS = {
		clientId: "com.grindrguy.grindrx.signin",
		scope: "email",
		redirectURI: "https://web.grindr.com/apple-login",
	};

	const AUTH_ENDPOINT = "https://appleid.apple.com/auth/authorize";
	const MESSAGE_ORIGIN = "https://appleid.apple.com";
	const CANCELLED = new Set([
		"popup_closed_by_user",
		"user_cancelled_authorize",
	]);

	const buildAuthUrl = (
		{ clientId, scope, redirectURI },
		{ state, frameId },
	) => {
		const params = new URLSearchParams({
			client_id: clientId,
			redirect_uri: redirectURI,
			response_type: "code id_token",
			state,
			scope,
			response_mode: "web_message",
			frame_id: frameId,
			m: "01",
			v: "1.5.7",
		});
		return `${AUTH_ENDPOINT}?${params.toString()}`;
	};

	const requestAuthorization = (options = {}) => {
		const config = { ...DEFAULTS, ...options };
		return new Promise((resolve, reject) => {
			const state = crypto.randomUUID();
			let settled = false;
			let popup = null;
			let poll = null;

			const teardown = () => {
				window.removeEventListener("message", onMessage);
				if (poll) clearInterval(poll);
			};
			const resolveOnce = (result) => {
				if (settled) return;
				settled = true;
				teardown();
				resolve(result);
			};
			const rejectOnce = (code, message) => {
				if (settled) return;
				settled = true;
				teardown();
				const error = new Error(message || code);
				error.code = code;
				reject(error);
			};

			const onMessage = (event) => {
				if (event.origin !== MESSAGE_ORIGIN) return;
				let message;
				try {
					message = JSON.parse(event.data);
				} catch {
					return;
				}
				if (message?.method !== "oauthDone") return;
				const data = message.data ?? {};
				const authorization = data.authorization;
				if (data.error) {
					const code = String(data.error?.error ?? data.error);
					rejectOnce(CANCELLED.has(code) ? "popup_closed" : code);
				} else if (authorization?.state !== state) {
					return;
				} else if (authorization.code) {
					resolveOnce(authorization.code);
				} else {
					rejectOnce("Apple returned no authorization code");
				}
				try {
					popup?.close();
				} catch {
					// popup may already be closed
				}
			};

			window.addEventListener("message", onMessage);
			popup = window.open(
				buildAuthUrl(config, { state, frameId: crypto.randomUUID() }),
				"_blank",
				"popup,width=700,height=700",
			);
			if (!popup) {
				rejectOnce("popup_failed_to_open");
				return;
			}
			poll = setInterval(() => {
				if (popup.closed) rejectOnce("popup_closed");
			}, 500);
		});
	};

	window.__grindrApple = { requestAuthorization };
})();
