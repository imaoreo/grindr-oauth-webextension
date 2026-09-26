import type { Element, HTMLScriptElement, Window } from "happy-dom";

import {
	GIS_CLIENT_URL,
	RESULT_CHANNEL,
	SIGN_IN_URL,
	TEXT,
} from "./extension-contract";
import { EXTENSION_ID, targetFiles } from "./extension-files";
import { type AppleOutcome, installFakeApple } from "./fake-apple";
import {
	DEFAULT_TAB_ID,
	type Extension,
	type RuntimeMessage,
} from "./fake-background";
import { FakeClock } from "./fake-clock";
import { type GisOutcome, installFakeGis } from "./fake-gis";
import { pageUi } from "./page-ui";
import {
	type ClipboardOptions,
	closeWindowOnce,
	createPageWindow,
	installClipboard,
	selectedText,
} from "./page-window";
import { interceptScriptLoads } from "./script-loader";
import { extensionNamespace, runScript } from "./script-runner";
import { flush, waitFor } from "./waiting";

export type ContextState =
	"alive" | "invalidated" | "invalidated-manifest-throws" | "runtime-gone";

export type TabOptions = ClipboardOptions & {
	tabId?: number;
	gis?: GisOutcome[];
	apple?: AppleOutcome[];
	injectFails?: string;
	gsiLoadFailures?: number;
	context?: ContextState;
	sendMessageRejects?: string;
};

export type PageResult = {
	channel: string;
	phase?: string;
	token?: string;
	provider?: string;
	error?: string;
};

const GRINDR_PAGE = `<head><title>Grindr</title></head><body><div id="grindr-root"><h1>Grindr Web</h1><p class="app">Grindr web app placeholder</p></div></body>`;

const isPageResult = (data: unknown): data is PageResult =>
	typeof data === "object" &&
	data !== null &&
	"channel" in data &&
	data.channel === RESULT_CHANNEL;

const INVALIDATED = "Extension context invalidated.";

const createContentContext = (options: TabOptions) => ({
	state: options.context ?? ("alive" as ContextState),
	sendMessageRejects: options.sendMessageRejects ?? null,
	sendMessageOverride: null as null | ((message: RuntimeMessage) => unknown),
});

type ContentContext = ReturnType<typeof createContentContext>;

const contentExtensionApi = ({
	extension,
	context,
	tabId,
}: {
	extension: Extension;
	context: ContentContext;
	tabId: number;
}) => {
	const runtime = {
		get id() {
			return context.state === "alive" ? EXTENSION_ID : undefined;
		},
		getManifest: () => {
			if (
				context.state === "invalidated-manifest-throws" ||
				context.state === "runtime-gone"
			) {
				throw new Error(INVALIDATED);
			}
			return extension.manifest;
		},
		getURL: extension.getURL,
		sendMessage: (message: RuntimeMessage) => {
			if (context.state !== "alive") throw new Error(INVALIDATED);
			if (context.sendMessageOverride) {
				extension.messages.push({
					message: structuredClone(message),
					tabId,
				});
				return context.sendMessageOverride(message);
			}
			if (context.sendMessageRejects) {
				return Promise.reject(new Error(context.sendMessageRejects));
			}
			return extension.dispatch({
				message,
				sender: { tab: { id: tabId }, id: EXTENSION_ID },
			}).reply;
		},
	};
	return {
		get runtime() {
			return context.state === "runtime-gone" ? undefined : runtime;
		},
	};
};

const pageScriptGlobals = (window: Window) => ({
	window,
	document: window.document,
	location: window.location,
	setTimeout: window.setTimeout.bind(window),
	clearTimeout: window.clearTimeout.bind(window),
	setInterval: (callback: () => void, delay: number) =>
		window.setInterval(callback, Math.min(delay, 5)),
	clearInterval: window.clearInterval.bind(window),
	URLSearchParams,
});

export const openTab = (extension: Extension, options: TabOptions = {}) => {
	const { target, manifest, getURL } = extension;
	const files = targetFiles(target);
	const tabId = options.tabId ?? DEFAULT_TAB_ID;
	const window = createPageWindow(SIGN_IN_URL);
	const document = window.document;
	document.documentElement.innerHTML = GRINDR_PAGE;
	const uiClock = new FakeClock();
	const alerts: string[] = [];
	const injected: string[] = [];
	const results: PageResult[] = [];
	const pageErrors: string[] = [];
	const context = createContentContext(options);
	const gis = installFakeGis(window, { outcomes: options.gis ?? [] });
	const apple = installFakeApple(window, { outcomes: options.apple ?? [] });
	const openGisPopup = window.open.bind(window);
	Object.assign(window, {
		open: (url: string) =>
			url.startsWith("https://appleid.apple.com/")
				? apple.open(url)
				: openGisPopup(url),
	});
	const clipboard = installClipboard(window, options);
	let gsiLoadFailures = options.gsiLoadFailures ?? 0;
	let windowStops = 0;

	Object.assign(window, {
		alert: (message: unknown) => alerts.push(String(message)),
		stop: () => {
			windowStops += 1;
		},
	});
	window.addEventListener("error", (event) => {
		pageErrors.push(
			event instanceof window.ErrorEvent
				? String(event.error?.message ?? event.message)
				: event.type,
		);
	});
	window.addEventListener("message", (event) => {
		if (event instanceof window.MessageEvent && isPageResult(event.data)) {
			results.push(event.data);
		}
	});

	const finishLoad = ({
		script,
		succeeded,
	}: {
		script: HTMLScriptElement;
		succeeded: boolean;
	}) => {
		const event = new window.Event(succeeded ? "load" : "error");
		if (succeeded) script.onload?.(event);
		else script.onerror?.(event);
	};

	const loadScript = (script: HTMLScriptElement) => {
		const src = script.src;
		const extensionBase = getURL("");
		if (src.startsWith(extensionBase)) {
			const path = src.slice(extensionBase.length);
			injected.push(path);
			if (options.injectFails === path) {
				finishLoad({ script, succeeded: false });
				return;
			}
			runScript({
				source: files.source(path),
				globals: pageScriptGlobals(window),
			});
			finishLoad({ script, succeeded: true });
			return;
		}
		injected.push(src);
		if (src !== GIS_CLIENT_URL) {
			finishLoad({ script, succeeded: false });
			return;
		}
		if (gsiLoadFailures > 0) {
			gsiLoadFailures -= 1;
			finishLoad({ script, succeeded: false });
			return;
		}
		gis.installTokenClient();
		finishLoad({ script, succeeded: true });
	};

	interceptScriptLoads({
		window,
		load: (script) => window.setTimeout(() => loadScript(script)),
	});

	const contentGlobals = {
		window,
		document,
		location: window.location,
		history: window.history,
		navigator: clipboard.navigator,
		getSelection: () => window.getSelection(),
		setTimeout: uiClock.setTimeout,
		clearTimeout: uiClock.clearTimeout,
		...extensionNamespace({
			target,
			api: contentExtensionApi({ extension, context, tabId }),
		}),
	};
	for (const entry of manifest.content_scripts ?? []) {
		for (const path of entry.js ?? []) {
			runScript({ source: files.source(path), globals: contentGlobals });
		}
	}

	const ui = pageUi(window);

	const trustedClick = (element: Element) => {
		const event = new window.MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			composed: true,
		});
		Object.defineProperty(event, "isTrusted", { value: true });
		element.dispatchEvent(event);
	};

	const signedInThenReadyAgain = (since: number) => {
		const later = results.slice(since);
		const started = later.findIndex(({ phase }) => phase === "signing-in");
		return (
			started >= 0 &&
			later.slice(started + 1).some(({ phase }) => phase === "ready")
		);
	};

	return {
		window,
		document,
		uiClock,
		alerts,
		injected,
		pageErrors,
		context,
		gis,
		apple,
		clipboard,
		ui,
		get windowStops() {
			return windowStops;
		},
		html: () => document.documentElement.outerHTML,
		selection: () => selectedText(window),
		selectionDetached: () => {
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return true;
			return !selection.getRangeAt(0).commonAncestorContainer
				?.isConnected;
		},
		trustedClick,
		clickUntilReadyAgain: async (element: Element) => {
			const since = results.length;
			trustedClick(element);
			await waitFor(() => signedInThenReadyAgain(since), {
				label: "signing-in then ready",
			});
			await flush();
		},
		postResult: (data: Omit<PageResult, "channel">) =>
			window.postMessage(
				{ channel: RESULT_CHANNEL, ...data },
				window.location.origin,
			),
		pagehide: () =>
			window.dispatchEvent(
				new window.Event("pagehide", { bubbles: false }),
			),
		whenReady: () =>
			waitFor(() => ui.button.textContent === TEXT.signIn, {
				label: "sign-in button ready",
			}),
		whenTokenShown: () => waitFor(() => ui.token, { label: "token view" }),
		close: closeWindowOnce(window),
	};
};

export type Tab = ReturnType<typeof openTab>;
