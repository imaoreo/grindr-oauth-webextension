import type { Window } from "happy-dom";

export const APPLE_ORIGIN = "https://appleid.apple.com";

export type AppleOutcome =
	| "code"
	| "cancelled"
	| "popup_closed"
	| "popup_failed_to_open"
	| "invalid_client"
	| "pending";

type FakePopup = { closed: boolean; close: () => void };

let issued = 0;

const makeCode = () => {
	issued += 1;
	return `c${String(issued).padStart(4, "0")}${"a1b2c3d4e5".repeat(5)}.0.rrqx.${"Zy9_".repeat(8)}`;
};

const makeIdToken = () =>
	`eyJraWQiOiJBSURPUEsxIn0.${"eyJhdWQi".repeat(12)}.sig${issued}`;

export const installFakeApple = (
	window: Window,
	{ outcomes }: { outcomes: AppleOutcome[] },
) => {
	const queuedOutcomes = [...outcomes];
	const codesIssued: string[] = [];
	const popups: Array<{ url: URL; popup: FakePopup }> = [];

	const post = (data: unknown, origin = APPLE_ORIGIN) =>
		window.dispatchEvent(
			new window.MessageEvent("message", {
				origin,
				data: JSON.stringify(data),
			}),
		);

	const respond = ({
		outcome,
		popup,
		state,
	}: {
		outcome: AppleOutcome;
		popup: FakePopup;
		state: string | null;
	}) => {
		if (outcome === "popup_closed") {
			popup.closed = true;
			return;
		}
		if (outcome === "cancelled" || outcome === "invalid_client") {
			const error =
				outcome === "cancelled"
					? "user_cancelled_authorize"
					: "invalid_client";
			post({ method: "oauthDone", data: { error } });
			return;
		}
		const code = makeCode();
		codesIssued.push(code);
		post({
			method: "oauthDone",
			data: { authorization: { code, id_token: makeIdToken(), state } },
		});
	};

	const open = (url: string) => {
		const outcome = queuedOutcomes.shift() ?? "code";
		if (outcome === "popup_failed_to_open") return null;
		const popup: FakePopup = {
			closed: false,
			close: () => {
				popup.closed = true;
			},
		};
		const authUrl = new URL(url);
		popups.push({ url: authUrl, popup });
		const state = authUrl.searchParams.get("state");
		if (outcome !== "pending") {
			window.setTimeout(() => respond({ outcome, popup, state }));
		}
		return popup;
	};

	return {
		open,
		post,
		codesIssued,
		popups,
		get lastState() {
			return popups.at(-1)?.url.searchParams.get("state") ?? null;
		},
	};
};

export type FakeApple = ReturnType<typeof installFakeApple>;
