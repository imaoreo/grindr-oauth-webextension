# Grindr OAuth WebExtension

WebExtension that gets a Grindr sign-in token from Google or Apple for [Native Grind](https://nativegrind.imaoreo.dev). It runs Google Identity Services (GIS) and Sign in with Apple on `web.grindr.com`, which works because GIS refuses to run in embedded app WebViews and GeckoView forbids the host app from injecting JS into pages.

Based on the [Grindr Google OAuth WebExtension](https://git.opengrind.org/open-grind/grindr-google-oauth-webextension) by Open Grind, which this project forks and extends with Sign in with Apple.

![Screenshot](./contrib/screenshot.avif)

## Install

Build the extension with `./build.sh [firefox|chrome|geckoview]` (requires `zip`). The builds land in `web-ext-artifacts/`. [Node.js](https://nodejs.org) is only needed for development: run `npm install`, then `npm test`, `npm run lint` and `npm run check:format`. With Node installed, Firefox builds are also checked with `web-ext lint`.

- **Firefox, Librewolf** (desktop & Android): load `web-ext-artifacts/firefox/` via `about:debugging` (This Firefox → "Load Temporary Add-on")
- **Google Chrome, Chromium & Chromium-based browsers** (desktop only): load `web-ext-artifacts/chrome/` via `chrome://extensions` (Developer mode → "Load unpacked")
- **GeckoView** (for developers embedding this project into their Android app): bundle `web-ext-artifacts/geckoview/` in your app's `assets/` and install it as a built-in extension via `runtime.webExtensionController.ensureBuiltIn(uri, id)` (`nativeMessaging` and `geckoViewAddons` are privileged permissions that only work for a built-in extension)

## Usage

**Firefox, Librewolf** (desktop & Android) and **Google Chrome, Chromium & Chromium-based browsers** (desktop only):

1. Install the extension
2. Click the toolbar icon
3. A new tab opens with a button
4. Click "Sign in with Google" or "Sign in with Apple"
5. Complete the sign-in in the window that opens
6. Tap "Copy token" (Google) or "Copy code" (Apple) on the page and paste it into Native Grind. An Apple code works once and expires in 5 minutes.

**GeckoView**:

1. Install the extension as a built-in (see above) and load `https://web.grindr.com/` in a `GeckoSession`. If the session is private, allow the extension in private browsing.
2. The content script blanks the page and shows "Sign in with Google" and "Sign in with Apple" buttons. After the user signs in, the token is sent to your app over native messaging.
3. Register the delegate on the extension:

```kotlin
runtime.webExtensionController
    .ensureBuiltIn(
        "resource://android/assets/grindr-google-oauth/",
        "grindr-google-oauth-webextension@imaoreo.dev",
    )
    .accept { extension ->
        extension?.setMessageDelegate(delegate, "grindr_google_oauth")
        runtime.webExtensionController.setAllowedInPrivateBrowsing(extension!!, true)
    }
```

The delegate receives:

| Message                                                        | Meaning                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `{ "type": "token", "token": "ya29..." }`                      | the access token                                                           |
| `{ "type": "token", "token": "c1a2...", "provider": "apple" }` | a Sign in with Apple authorization code (single use, expires in 5 minutes) |
| `{ "type": "error", "error": "..." }`                          | sign-in failed; the reason is already on screen in the page                |

Answer every message from `onMessage`:

- `GeckoResult.fromValue(true)` once you have taken the token, or for an error you have noted
- `GeckoResult.fromException(...)` to refuse it, which puts the page back on "Try again"
- Any other reply, including `false` or `null`, also counts as taken. The page then stays on "Signing in with Google...", so move the session on (the reference app loads `shared/token.html#<token>`)
- Reply with a primitive. A `JSONObject` reply fails with "Invalid event data for callback" and the page hangs until it times out.
- Reply within 10 seconds. After that the page shows "The app didn't answer." and re-enables the button.

One delegate is kept per runtime, per extension id and native app name, and the last registration wins. If more than one activity shares the runtime, register again in `onResume()`, or a finished activity keeps the delegate and tokens go nowhere. GeckoView also queues messages sent while no delegate is registered, so register before loading the page.

A session-level delegate (`session.webExtensionController.setMessageDelegate(extension, delegate, name)`) receives messages from extension pages in that session. This extension sends none, so you do not need one.

The token or code is then sent to Grindr's `/v8/sessions/thirdparty` endpoint.

## License

[MIT](./LICENSE). Copyright Jay Brammeld, with the original work copyright Open Grind Governance.
