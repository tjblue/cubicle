# Cubicle app guide

This desktop application is undergoing an experimental migration from Tauri 2 to Tauri 3 alpha. Windows uses the system WebView2 runtime, while Linux and macOS use the CEF webview runtime. It has Dockview panes and real terminal tabs. The Files tool browses folders in a right-side tree and previews UTF-8 text files up to 1 MB. Markdown files render with a floating heading outline and can be edited and saved; filtering searches folders already opened in the tree. The Browser tool opens web pages in embedded webviews. The migration has not been validated on any of these platforms yet. Treat desktop behavior as experimental.

Choose **Terminal** in a new tab to start a shell. Run installed command-line tools from the prompt, for example `codex`, `claude`, `gemini`, or `pi`; the corresponding tool must already be installed and available in the app's PATH. Each terminal tab has a separate shell. When Cubicle closes normally, it saves each terminal's last known folder and opens a new shell there when the workspace is restored; CLI conversations can be resumed manually. On Linux it checks the shell process's folder, and on other systems folder changes are tracked when the shell sends OSC 7 directory updates. Terminal tabs follow title changes sent by command-line programs. Double-click a tab to set a custom name; clear the name to follow the terminal title again. Choose Browser in multiple Dockview tabs to keep separate pages and navigation histories; use the address bar to visit a site or search. Browser tabs remain open while switching panels. Chrome extensions are not supported. Closing a terminal tab ends its shell session.

Launch the built Windows application directly:

```powershell
& ".\src-tauri\target\release\cubicle.exe"
```

To develop from source, install Node.js, Rust 1.95 or newer, and the [Tauri platform prerequisites](https://v3.tauri.app/start/prerequisites/). CEF adds these requirements:

- macOS needs CMake and Ninja to build CEF's C++ wrapper.
- On Linux and macOS, the first build downloads about 1 GB of CEF files for the target platform. The cache is shared by Tauri projects; `CEF_PATH` can point to a different cache or an extracted CEF distribution.
- Linux needs the Tauri Linux development dependencies and a working Chromium sandbox configuration. Sandbox behavior depends on distribution and package format.

The CEF runtime is part of Tauri 3 alpha and its API may change. Keep this migration experimental until builds and interactive browser behavior have been checked on each supported OS.

To develop from source:

```powershell
cd "C:\path\to\cubicle"
npm install
npm run desktop:dev
```

Drag tabs to split or regroup panes, drag dividers to resize, or use the buttons to add panes and reset the layout. `npm run desktop:build` invokes `tauri build --no-bundle`. It does not assemble a distributable package or installer, so it does not validate final package layout, macOS helper-app signing, or Linux package sandbox behavior. `npm run dev` runs the interface in a browser; desktop features require the Tauri app.

Spaces remember each Files pane's current folder and selected preview, and each Browser pane's last reported page URL. These reopen with the saved layout after restarting Cubicle. Saved browser pages are paused on restoration; select **Load page** or enter another address to navigate. If a folder or file is unavailable, the Files pane shows an error; you can choose another folder or file. Unsaved Markdown edits and browser history are not restored.

## Terminal attention indicators

Use the bell in a terminal pane's toolbar to enable attention indicators for that pane. When a terminal program sends an OSC 9 notification or terminal bell, Cubicle marks the tab and its space. Open the tab or click inside the terminal to clear the mark. The bell preference is saved with the pane; marks are cleared when the app closes. These signals can come from any terminal program and do not identify whether an AI turn finished or needs approval. This does not detect ordinary command completion or send operating system notifications.

For a Codex CLI test, enable the pane's bell and start Codex with terminal notifications enabled:

```powershell
codex -c 'tui.notifications=true' -c 'tui.notification_method="osc9"' -c 'tui.notification_condition="always"'
```

Ask Codex to complete a task and switch to another tab or space while it works. Codex configuration and supported options may vary by version. The CLI must emit a notification for Cubicle to show a mark.

Use **Edit → Settings** (or **View → Pane appearance**) to choose split controls in the tab strip or a separate toolbar, and to toggle soft tabs, the active-group outline, and compact new-tab cards. These preferences are saved locally.

Right-click a tab to create a named tab group or add it to an existing group. The same menu lets you rename or recolor a group, remove a tab, or ungroup all its tabs. Group membership is saved with each space.

The interactive mockups live in `playground/`. Start `npm run dev` and open [the tab group playground](http://127.0.0.1:4179/playground/tab-groups.html) to compare group appearances and interactions. These prototypes use sample data and do not modify your workspace.

## Space profiles

Create and launch reusable pane layouts from **Edit → Settings → Space profiles**. See the [space profiles guide](guides/space-profiles.md) for configuration, examples, and import and export instructions.

## Experimental CEF migration and validation status

The project uses Tauri 3 alpha with system WebView2 on Windows and `tauri-runtime-cef` on Linux and macOS. CEF bundles Chromium. The runtime is experimental, and Tauri warns that its APIs may change before stable release. Bundles on CEF platforms will be hundreds of megabytes larger than with the system webview and use more memory. See the [Tauri 3 migration guide](https://v3.tauri.app/start/migrate/from-tauri-2/) and [CEF guide](https://v3.tauri.app/develop/cef/).

No Windows, macOS, or Linux build or interactive workflow is documented as validated yet. In particular, the embedded browser's pane positioning, resizing, visibility, focus and keyboard input, navigation events, favicon reporting, popups, storage, and media playback need platform checks. The main app also needs checks for terminal input and resize, clipboard behavior, file dialogs, Markdown editing, and persisted workspace restoration. Existing automated tests do not establish desktop or CEF compatibility.

The current `desktop:build` script deliberately passes `--no-bundle`. It does not assemble or validate the Windows, macOS, or Linux distributable packages. Test release packaging separately before claiming a supported installer or package format. On macOS, CEF requires helper apps and Chromium signing entitlements; Linux package formats have different sandbox constraints. An AppImage may not retain the setuid sandbox helper and can depend on unprivileged user namespaces.

The following reports describe the previous Tauri 2 system-webview behavior, not verified CEF results:

On Linux under the former WebKitGTK runtime, the browser showed renderer crashes and YouTube playback failures on Arch Linux. One reported failure printed `WebLoaderStrategy::internallyFailedLoadTimerFired`; the underlying cause was not confirmed. Installing `gst-plugins-good` resolved a missing GStreamer `autoaudiosink` warning, but renderer failures persisted. These reports concern the previous WebKitGTK implementation; CEF behavior has not been tested against them.

On macOS, the previous implementation used WKWebView. Its behavior does not predict the unvalidated CEF implementation.
