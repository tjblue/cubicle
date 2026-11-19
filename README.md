# Cubicle

### Your project, in its own space.

Cubicle brings **terminals, files, and the web** together in one flexible desktop workspace. Split the view around the way you work, keep projects in separate Spaces, and pick up where you left off with saved layouts.

## One workspace. All your tools.

| 💻 Terminal | 📁 Files & Markdown | 🌐 Embedded browser |
| --- | --- | --- |
| Run multiple shell sessions, customize startup profiles, copy and paste, and open files from clickable terminal paths. Optional attention alerts help you spot bells and notifications. | Browse folders, search filenames, pin useful locations, and preview source with syntax highlighting. Read and edit Markdown with rendered previews, heading navigation, and local images. | Search or enter a URL, navigate pages, keep favorites, open local HTML, and use popup links in new tabs. Windows can import browser extensions from Edge or a folder. |

### Arrange it your way

- **Spaces** keep project folders, colors, panes, tabs, and saved layouts together.
- **Split panes** horizontally or vertically, then resize and rearrange as you work.
- **Tab groups** keep related sessions together with names and colors.
- **Space profiles** launch a ready-made project setup with panes, folders, shells, favorites, and pins.
- **Recovery and preferences** help manage workspace persistence, appearance, and unsaved Markdown edits.

## Start a project space

Create a Space for a project folder, then add a terminal, Files pane, or browser tab. Or save a reusable profile and launch a complete layout when you need it.

For example, a profile can open a dev server, project files, and the local app in one go:

```json
{
  "name": "Web project",
  "description": "Server, source, and local preview",
  "root": "C:/Projects/my-app",
  "panes": [
    { "type": "terminal", "title": "Dev server", "command": "npm run dev" },
    "files",
    { "type": "browser", "url": "http://localhost:3000" }
  ]
}
```

Launch profiles into a new Space, append panes to an existing one, or replace its layout. Commands are shown for confirmation before they run. See the [Space profiles guide](docs/guides/space-profiles.md) for options and examples.

## Get started
### Quick Install
The pre-built `.exe` is available under the [releases of this repo](https://github.com/tjblue/cubicle/releases).

### Build `.exe` yourself
Install Node.js, Rust, and the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/), then run:

```powershell
npm install
npm run desktop:dev
```

To build the desktop executable:

```powershell
npm run desktop:build
```

The executable is written to `src-tauri/target/release/cubicle.exe`. This command does not create an installer.

### Other useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the frontend at `http://127.0.0.1:4179` (desktop features require Tauri). |
| `npm run build` | Build the frontend only. |
| `npm test` | Run the JavaScript test suite. |

## Notes

- Saved Spaces restore layouts, but do not restore running shell processes or terminal scrollback after the app exits.
- Browser extensions are supported on Windows. WebView2 does not provide standard browser toolbar and popup entry points, so some extensions may be limited. Updates must currently be imported manually.

## Project docs

- [Feature overview and components](docs/features.md)
- [Space profiles: setup and examples](docs/guides/space-profiles.md)
- [UI style guide](docs/ui-style-guide.md)
