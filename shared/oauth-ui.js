(() => {
	"use strict";

	if (window.__grindrOauthUi) return;

	const COPIED_RESET_MS = 2500;
	const PROVIDER_NAMES = { google: "Google", apple: "Apple" };

	let cardEl = null;
	let buttonEl = null;
	let appleButtonEl = null;
	let errorEl = null;
	let activeProvider = "google";

	const element = (tag, className, text) => {
		const el = document.createElement(tag);
		el.className = className;
		if (text !== undefined) el.textContent = text;
		return el;
	};

	const mount = () => {
		document.documentElement.classList.add("grindr-oauth-active");

		const overlay = element("div", "grindr-oauth-overlay");
		cardEl = element("div", "grindr-oauth-card");

		buttonEl = element("button", "grindr-oauth-button", "Loading...");
		buttonEl.type = "button";
		buttonEl.dataset.provider = "google";
		buttonEl.disabled = true;

		appleButtonEl = element(
			"button",
			"grindr-oauth-button grindr-oauth-button-apple",
			"Sign in with Apple",
		);
		appleButtonEl.type = "button";
		appleButtonEl.dataset.provider = "apple";
		appleButtonEl.disabled = true;

		errorEl = element("p", "grindr-oauth-error");
		errorEl.setAttribute("role", "alert");
		errorEl.hidden = true;

		cardEl.append(buttonEl, appleButtonEl, errorEl);
		overlay.append(cardEl);
		document.documentElement.append(overlay);
	};

	const setError = (message) => {
		if (!errorEl) return;
		errorEl.textContent = message || "";
		errorEl.hidden = !message;
	};

	const buttonFor = (provider) =>
		provider === "apple" ? appleButtonEl : buttonEl;

	const setPhase = (phase, provider) => {
		if (!buttonEl) return;
		if (phase !== "failed") setError("");
		if (phase === "signing-in" && provider) activeProvider = provider;
		for (const id of Object.keys(PROVIDER_NAMES)) {
			const button = buttonFor(id);
			const name = PROVIDER_NAMES[id];
			const active = id === activeProvider;
			if (phase === "loading") {
				button.disabled = true;
				button.textContent =
					id === "google" ? "Loading..." : `Sign in with ${name}`;
			} else if (phase === "ready") {
				button.disabled = false;
				button.textContent = `Sign in with ${name}`;
			} else if (phase === "signing-in") {
				button.disabled = true;
				if (active) button.textContent = `Signing in with ${name}...`;
			} else if (phase === "failed") {
				button.disabled = false;
				button.textContent = active
					? "Try again"
					: `Sign in with ${name}`;
			}
		}
		if (phase === "ready") buttonFor(activeProvider).focus();
	};

	const selectContents = (node) => {
		const range = document.createRange();
		range.selectNodeContents(node);
		const selection = getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	};

	const copyFromSelection = (node) => {
		selectContents(node);
		try {
			return document.execCommand("copy");
		} catch {
			return false;
		}
	};

	const showTokenCard = (children) => {
		if (!cardEl) mount();
		buttonEl = null;
		appleButtonEl = null;
		errorEl = null;
		cardEl.classList.add("grindr-oauth-token-card");
		cardEl.replaceChildren(...children);
	};

	const showMissingToken = () => {
		showTokenCard([
			element("h1", "grindr-oauth-token-title", "No token here"),
			element("p", "grindr-oauth-token-status", "Run the sign-in again."),
		]);
	};

	const TOKEN_COPY = {
		google: {
			title: "Your Google sign-in token",
			copy: "Copy token",
			copied: "Full token copied to your clipboard.",
			expiry: "The token expires in about an hour.",
		},
		apple: {
			title: "Your Apple sign-in code",
			copy: "Copy code",
			copied: "Full code copied to your clipboard.",
			expiry: "The code works once and expires in 5 minutes, so use it right away.",
		},
	};

	const showToken = (token, { focus = false, provider = "google" } = {}) => {
		if (!token) {
			showMissingToken();
			return;
		}

		const text = TOKEN_COPY[provider] ?? TOKEN_COPY.google;
		const field = element("p", "grindr-oauth-token", token);
		const copyButton = element(
			"button",
			"grindr-oauth-token-copy",
			text.copy,
		);
		copyButton.type = "button";
		const status = element("p", "grindr-oauth-token-status");
		status.setAttribute("role", "status");
		const note = element("p", "grindr-oauth-token-note");
		note.append(
			"Paste it into ",
			element("strong", "", "Native Grind"),
			`. Don't share it publicly. ${text.expiry}`,
		);

		let resetTimer = 0;

		const onCopied = () => {
			clearTimeout(resetTimer);
			status.classList.remove("is-error");
			copyButton.textContent = "Copied";
			status.textContent = text.copied;
			resetTimer = setTimeout(() => {
				copyButton.textContent = text.copy;
			}, COPIED_RESET_MS);
		};

		const onCopyFailed = () => {
			clearTimeout(resetTimer);
			copyButton.textContent = text.copy;
			status.classList.add("is-error");
			status.textContent =
				"Couldn't reach the clipboard. Tap the token, then copy it.";
			selectContents(field);
		};

		const settle = (copied) => (copied ? onCopied() : onCopyFailed());

		copyButton.addEventListener("click", () => {
			if (!navigator.clipboard?.writeText) {
				settle(copyFromSelection(field));
				return;
			}
			navigator.clipboard
				.writeText(token)
				.then(onCopied, () => settle(copyFromSelection(field)));
		});

		showTokenCard([
			element("h1", "grindr-oauth-token-title", text.title),
			field,
			copyButton,
			status,
			note,
		]);
		if (focus) copyButton.focus();
		window.addEventListener(
			"pagehide",
			() => {
				clearTimeout(resetTimer);
				showMissingToken();
			},
			{ once: true },
		);
	};

	window.__grindrOauthUi = { mount, setError, setPhase, showToken };
})();
