import { Window } from "happy-dom";

export type ClipboardMode =
	"resolve" | "reject" | "missing-api" | "missing-writeText";

export type ExecCommandMode = "true" | "false" | "throw";

export type ClipboardOptions = {
	clipboard?: ClipboardMode;
	execCommand?: ExecCommandMode;
};

const USER_AGENT = "grindr-oauth-webextension-tests";

export const createPageWindow = (url: string) =>
	new Window({
		url,
		settings: {
			disableJavaScriptEvaluation: true,
			disableJavaScriptFileLoading: true,
			disableCSSFileLoading: true,
			disableIframePageLoading: true,
			navigator: { userAgent: USER_AGENT },
		},
	});

export const selectedText = (window: Window) =>
	String(window.getSelection()?.toString() ?? "");

export const installClipboard = (window: Window, options: ClipboardOptions) => {
	const writes: string[] = [];
	const execCalls: Array<{ command: string; selection: string }> = [];
	const behavior: Required<ClipboardOptions> = {
		clipboard: options.clipboard ?? "resolve",
		execCommand: options.execCommand ?? "false",
	};

	const writeText = (text: string) => {
		writes.push(text);
		return behavior.clipboard === "resolve"
			? Promise.resolve()
			: Promise.reject(new DOMException("Document is not focused."));
	};

	const navigator = {
		userAgent: USER_AGENT,
		get clipboard() {
			if (behavior.clipboard === "missing-api") return undefined;
			if (behavior.clipboard === "missing-writeText") return {};
			return { writeText };
		},
	};

	Object.assign(window.document, {
		execCommand: (command: string) => {
			execCalls.push({ command, selection: selectedText(window) });
			if (behavior.execCommand === "throw") {
				throw new Error("execCommand denied");
			}
			return behavior.execCommand === "true";
		},
	});

	return { writes, execCalls, behavior, navigator };
};

export const closeWindowOnce = (window: Window) => {
	let closing: Promise<void> | undefined;
	return () =>
		(closing ??= window.happyDOM
			.abort()
			.then(() => window.happyDOM.close()));
};
