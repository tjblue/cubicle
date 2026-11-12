# WebView2 browser review

Reviewed November 11, 2026 against the pinned Tauri 2.11.5 / Wry 0.55.1 implementation. Compilation and automated tests are not a substitute for the desktop checks below.

## Changes

- New-window requests for HTTP, HTTPS and file URLs now open a Browser tab beside the originating pane. Previously there was no handler connecting these requests to Dockview.
- Windows Back, Forward and Reload use WebView2 methods instead of page JavaScript. SourceChanged and HistoryChanged update the address bar (including same-document navigation) and history button availability.
- Browser accelerator keys, zoom controls and the link-hover status bar are enabled in browser views.
- Browser errors appear above the native view; event subscription completes before creating a browser.

## Remaining gaps

| Feature | Current status / limitation |
| --- | --- |
| Ordinary target=_blank links | Routed to a new tab; desktop acceptance check still required for Ctrl-click, middle-click and context-menu Open in new window. |
| Scripted popups / OAuth / payments | URL routing creates an independent GET navigation. It does not preserve window.opener, returned WindowProxy, postMessage relationships, named-window reuse, popup dimensions, POST bodies or blank-window document.write. about:blank, blob and data popup URLs report an error. These require native NewWindowRequested deferral and SetNewWindow with a shared WebView2 environment. Tauri's current Create response accepts a WebviewWindow, not our child Webview. |
| Popup blocking | No per-site policy or user-gesture filter. All supported-URL requests become tabs. |
| Navigation chrome | No loading progress, Stop button, custom failed-navigation/retry UI, or persisted browsing history. Engine error pages remain in use. History controls are updated natively on Windows only. |
| Keyboard | Engine accelerators enabled; desktop verification required for Find, Print, Reload and zoom. Ctrl+L, Ctrl+T and Ctrl+W are not bridged from the focused child webview into Cubicle's address bar/tab controls. |
| Downloads / uploads | Engine defaults; no Cubicle download manager, progress/history, cancellation or destination policy. File chooser, save dialog, blob downloads and PDF behavior need desktop testing. |
| Permissions | No Cubicle site-permission settings or remembered-permission management. Camera, microphone, geolocation, notifications and clipboard prompts require desktop verification. |
| External schemes | Address input / new-tab routing support HTTP, HTTPS and file only. No app-owned mailto/tel/custom-protocol confirmation flow. |
| Fullscreen / dialogs | No host integration for page-requested fullscreen. JavaScript dialogs and beforeunload need testing; Cubicle tab closure does not provide an explicit unsaved-web-form confirmation workflow. |
| Profile | Browser panes share a persistent profile separated from the privileged UI. No incognito, cookie/site-data clearing UI, password manager UI or certificate details UI. |
| Extensions | Existing unpacked extension management remains; browser toolbar/action UI and full Edge extension parity are not provided. |
| Non-Windows | Existing JavaScript history fallback remains; native tracking and accelerator configuration in this change apply to WebView2 only. |

## Desktop acceptance checklist (not yet executed)

1. Open a page, follow same-tab links and redirects, navigate fragments and SPA routes, then Back/Forward/Reload; verify address and enabled controls.
2. Open ordinary target=_blank links by click, Ctrl-click, middle-click and context menu. Confirm one tab in the originating group, including when another group is active.
3. Test window.open(url), window.open(''), a POST form targeting a new window, and an OAuth popup; distinguish supported URL routing from the documented popup limitations.
4. Test Ctrl+F, Ctrl+P, F5, Ctrl+plus/minus/0, text selection, copy/paste, file upload, normal/blob downloads and PDF viewing.
5. Test permission prompts, offline/certificate errors, JS dialogs, beforeunload and fullscreen video.
6. Switch spaces, move/resize panes, show application dialogs, close a source pane during navigation, and restart; verify visibility and restored URLs.

References: [Tauri NewWindowResponse](https://docs.rs/tauri/2.11.5/tauri/webview/enum.NewWindowResponse.html), [WebView2 NewWindowRequested](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.newwindowrequested).
