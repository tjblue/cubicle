# Cubicle app guide

This Tauri desktop application has Dockview panes and real terminal tabs. The Files tool browses folders in a right-side tree and previews UTF-8 text files up to 1 MB. Markdown files render with a floating heading outline and can be edited and saved; filtering searches folders already opened in the tree. The Browser tool opens web pages in embedded WebView2 views.

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

Use **Edit → Settings** (or **View → Pane appearance**) to choose split controls in the tab strip or a separate toolbar, and to toggle soft tabs, the active-group outline, and compact new-tab cards. These preferences are saved locally.

Right-click a tab to create a named tab group or add it to an existing group. The same menu lets you rename or recolor a group, remove a tab, or ungroup all its tabs. Group membership is saved with each space.

The interactive mockups live in `playground/`. Start `npm run dev` and open [the tab group playground](http://127.0.0.1:4179/playground/tab-groups.html) to compare group appearances and interactions. These prototypes use sample data and do not modify your workspace.

## Space profiles

Create and launch reusable pane layouts from **Edit → Settings → Space profiles**. See the [space profiles guide](guides/space-profiles.md) for configuration, examples, and import and export instructions.
