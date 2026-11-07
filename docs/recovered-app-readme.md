# Dockview Desktop

This Tauri desktop application has Dockview panes and real terminal tabs. The Files tool browses folders in a right-side tree and previews UTF-8 text files up to 1 MB. Markdown files render with a floating heading outline; filtering searches folders already opened in the tree. The Browser tool opens web pages in embedded WebView2 views.

Choose **Terminal** in a new tab to start PowerShell in your user folder. Run installed command-line tools from the prompt, for example `codex`, `claude`, `gemini`, or `pi`; the corresponding tool must already be installed and available in the app's PATH. Each terminal tab has a separate shell. Terminal tabs follow title changes sent by command-line programs. Double-click a tab to set a custom name; clear the name to follow the terminal title again. Choose Browser in multiple Dockview tabs to keep separate pages and navigation histories; use the address bar to visit a site or search. Browser tabs remain open while switching panels. Chrome extensions are not supported. Closing the tab ends its shell session.

Launch the built Windows application directly:

```powershell
& "C:\Users\tyler\Files\Projects\CLI Viewer\dockview-demo\desktop-build\dockview-desktop.exe"
```

To develop from source (requires Node.js, Rust, and Tauri's Windows prerequisites):

```powershell
cd "C:\Users\tyler\Files\Projects\CLI Viewer\dockview-demo"
npm install
npm run desktop:dev
```

Drag tabs to split or regroup panes, drag dividers to resize, or use the buttons to add panes and reset the layout. `npm run desktop:build` builds a standalone executable. `npm run dev` runs the interface in a browser.




Use **Edit → Settings** (or **View → Pane appearance**) to choose split controls in the tab strip or a separate toolbar, and to toggle soft tabs, the active-group outline, and compact new-tab cards. These preferences are saved locally.



Right-click a tab to create a named tab group or add it to an existing group. The same menu lets you rename or recolor a group, remove a tab, or ungroup all its tabs. Group membership is saved with each space.

The interactive mockups live in `playground/`. Start `npm run dev` and open [the tab group playground](http://127.0.0.1:4179/playground/tab-groups.html) to compare group appearances and interactions. These prototypes use sample data and do not modify your workspace.


## Space profiles

Open **Edit → Settings → Space profiles** to create, edit, import, export, and launch JSON profiles. Profiles are saved in the app's local storage independently of spaces. Select a profile and launch it into a new space, or first select an existing space and add its panes or replace its layout. Replacing a layout closes its terminal sessions and prompts about unsaved Markdown. Profile commands require confirmation and run only on launch, not when a saved space is restored.

A minimal profile is `{ "name": "My space" }`, which opens one terminal. For example:

```json
{
  "name": "Web project",
  "root": "C:/Projects/my-app",
  "direction": "row",
  "panes": [
    { "tabs": [
      { "type": "terminal", "title": "Server", "command": "npm run dev" },
      { "type": "terminal", "title": "Shell" }
    ], "active": 1 },
    { "type": "browser", "url": "http://localhost:3000", "favorites": [{ "name": "Docs", "url": "https://developer.mozilla.org" }] },
    { "type": "files", "pins": [{ "name": "Source", "path": "${workspace}/src" }] }
  ]
}
```

`direction` is `row` or `column`. Each entry in `panes` is a tool name, a tool object, or a `tabs` group; `active` is a 1-based tab number. Terminal objects may specify `title`, `cwd`, `shell`, `env` (string values), and `command`; browser objects support `title`, `url`, and `favorites`; Files objects support `title`, `root`, `pins`, and `reveal` (a file to open). `${workspace}` in paths expands to the target space's folder. When launching into an existing space, its folder is used. Paths must be usable on the machine running the app. The current implementation supports equally sized row or column splits, rather than the mockup's nested split tree and custom split sizes.
