# WebView2 browser review

Updated November 12, 2026 against the pinned Tauri 2.11.5 / Wry 0.55.1 implementation. Compilation and automated tests are not a substitute for the desktop checks below.

## Changes

- New-window requests for HTTP, HTTPS and file URLs now open a Browser tab beside the originating pane. Previously there was no handler connecting these requests to Dockview.
- Windows Back, Forward and Reload use WebView2 methods instead of page JavaScript. SourceChanged and HistoryChanged update the address bar (including same-document navigation) and history button availability.
- Browser accelerator keys, zoom controls and the link-hover status bar are enabled in browser views.
- Browser errors appear above the native view; event subscription completes before creating a browser.
- Loading changes Reload to Stop. Windows shortcuts Ctrl+L, Ctrl+T and Ctrl+W are routed from the browser view to Cubicle.
- The browser toolbar has a separate-window toggle for sites whose popups need their opener or original request. Blank popups use a separate window automatically. These paths require desktop verification.
- The downloads panel tracks WebView2 transfers for the current run and offers cancel and pause/resume. WebView2's native save UI remains in use. Browser privacy settings list/reset saved permissions and clear site data or disk cache on Windows.

## Remaining gaps

| Feature | Current status / limitation |
| --- | --- |
| Ordinary target=_blank links | Routed to a new tab; desktop acceptance check still required for Ctrl-click, middle-click and context-menu Open in new window. |
| Scripted popups / OAuth / payments | Default URL-to-tab routing creates an independent GET navigation and cannot preserve opener or POST. Toggle separate-window mode before opening a popup to use Tauri's native Create response; blank popups automatically use it. Actual opener, POST, nested popup and OAuth behavior still needs desktop testing. Tauri's Create response accepts a WebviewWindow, not our child Webview, so compatibility popups are separate windows with an origin in the title but no Cubicle address bar. |
| Popup blocking | No per-site policy or user-gesture filter. All supported-URL requests become tabs. |
| Navigation chrome | Reload/Stop and loading state are implemented, but no numeric progress, custom failed-navigation/retry UI, or persisted browsing history. Engine error pages remain in use. History controls are updated natively on Windows only. |
| Keyboard | Engine accelerators and Ctrl+L/T/W routing are implemented; desktop verification is required, including Find, Print, Reload and zoom. |
| Downloads / uploads | The panel tracks progress and actions during the current session. It can show completed files in their folder; it does not persist history or provide an open action. Tracking is attached before the requested initial navigation and to compatibility popup windows; this ordering requires desktop verification. File chooser, save dialog, blob downloads, pause/resume and PDF behavior need desktop testing. |
| Permissions | Windows settings can inspect and reset supported saved HTTP(S) site permissions; native WebView2 prompts remain in use. Camera, microphone, geolocation, notifications and clipboard prompts require desktop verification. |
| External schemes | Address input / new-tab routing support HTTP, HTTPS and file only. No app-owned mailto/tel/custom-protocol confirmation flow. |
| Fullscreen / dialogs | No host integration for page-requested fullscreen. JavaScript dialogs and beforeunload need testing; Cubicle tab closure does not provide an explicit unsaved-web-form confirmation workflow. |
| Profile | Browser panes share a persistent profile separated from the privileged UI. Site data and disk cache clearing are exposed in settings. No incognito, password manager UI or certificate details UI. |
| Extensions | Existing unpacked extension management remains; browser toolbar/action UI and full Edge extension parity are not provided. |
| Non-Windows | Existing JavaScript history fallback remains; native tracking and accelerator configuration in this change apply to WebView2 only. |

## Desktop acceptance checklist (not yet executed)

For the local popup fixture, run `node playground/browser-test-server.js` and open `http://127.0.0.1:4180/` in a Browser pane. The POST and opener checks should be run with the toolbar's separate-window mode enabled as well as in the default mode.

1. Open a page, follow same-tab links and redirects, navigate fragments and SPA routes, then Back/Forward/Reload; verify address and enabled controls.
2. Open ordinary target=_blank links by click, Ctrl-click, middle-click and context menu. Confirm one tab in the originating group, including when another group is active.
3. Test window.open(url), window.open(''), a POST form targeting a new window, and an OAuth popup; distinguish supported URL routing from the documented popup limitations.
4. Test Ctrl+F, Ctrl+P, F5, Ctrl+plus/minus/0, text selection, copy/paste, file upload, normal/blob downloads and PDF viewing.
5. Test permission prompts, offline/certificate errors, JS dialogs, beforeunload and fullscreen video.
6. Switch spaces, move/resize panes, show application dialogs, close a source pane during navigation, and restart; verify visibility and restored URLs.

References: [Tauri NewWindowResponse](https://docs.rs/tauri/2.11.5/tauri/webview/enum.NewWindowResponse.html), [WebView2 NewWindowRequested](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.newwindowrequested).
