# Cubicle app guide

This Tauri desktop application has Dockview panes and real terminal tabs. The Files tool browses folders in a right-side tree and previews UTF-8 text files up to 1 MB. Markdown files render with a floating heading outline and can be edited and saved; filtering searches folders already opened in the tree. The Browser tool opens web pages in embedded system webviews: WebView2 on Windows, WebKitGTK on Linux, and WKWebView on macOS.

Choose **Terminal** in a new tab to start a shell. Run installed command-line tools from the prompt, for example `codex`, `claude`, `gemini`, or `pi`; the corresponding tool must already be installed and available in the app's PATH. Each terminal tab has a separate shell. When Cubicle closes normally, it saves each terminal's last known folder and opens a new shell there when the workspace is restored; CLI conversations can be resumed manually. On Linux it checks the shell process's folder, and on other systems folder changes are tracked when the shell sends OSC 7 directory updates. Terminal tabs follow title changes sent by command-line programs. Double-click a tab to set a custom name; clear the name to follow the terminal title again. Choose Browser in multiple Dockview tabs to keep separate pages and navigation histories; use the address bar to visit a site or search. Browser tabs remain open while switching panels. Chrome extensions are not supported. Closing a terminal tab ends its shell session.

Launch the built Windows application directly:

```powershell
& ".\src-tauri\target\release\cubicle.exe"
```

To develop from source (requires Node.js, Rust, and Tauri's Windows prerequisites):

```powershell
cd "C:\path\to\cubicle"
npm install
npm run desktop:dev
```

Drag tabs to split or regroup panes, drag dividers to resize, or use the buttons to add panes and reset the layout. `npm run desktop:build` builds an executable without an installer. `npm run dev` runs the interface in a browser.

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

## Browser compatibility and Tauri 2 limitations

Cubicle uses Tauri 2's system webview rather than a bundled browser engine. Windows uses Chromium-based WebView2; Linux uses WebKitGTK and macOS uses WKWebView. Tauri 2 does not provide an official switch to a bundled Chromium/CEF runtime. Site behavior, web features, media playback, and rendering can therefore differ across platforms. Chrome extensions are not supported. See [Tauri's webview documentation](https://tauri.app/reference/webview-versions/).

On Linux, the browser has shown WebKit renderer crashes and YouTube playback failures on Arch Linux. One reported failure printed `WebLoaderStrategy::internallyFailedLoadTimerFired`; the underlying cause has not been confirmed. The missing GStreamer `autoaudiosink` warning was resolved by installing `gst-plugins-good`, but renderer failures persisted. Media playback depends on available GStreamer plugins and codecs; having a decoder installed does not guarantee a particular site will play. The GTK child-webview layout has required Cubicle-specific positioning, which needs further testing with resizing, multiple panes, and tab switching.

On macOS, the browser also uses WebKit rather than Chromium. It may have different site or media compatibility than WebView2; these particular Linux crashes have not been reproduced or established on macOS. Test macOS separately before assuming equivalent behavior.

Tauri 3's experimental CEF runtime can bundle Chromium, but is not an official Tauri 2 runtime and requires a migration to an alpha release. A third-party Tauri 2 CEF port exists but is archived and reports limited platform testing. Both options require validation of pane embedding, playback, packaging, and security updates before adoption. See the [Tauri 3 CEF guide](https://v3.tauri.app/develop/cef/) and the [community port](https://github.com/byeongsu-hong/tauri-runtime-cef).
