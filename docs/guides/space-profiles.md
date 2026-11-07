# Space profiles

A space profile is a reusable JSON description of the panes and tools you want to open together. Create several profiles for different projects or activities, then launch one into a new space or the current space.

## Create and launch a profile

1. Open **Edit → Settings → Space profiles**.
2. Select **New**, then edit the JSON. The example below is a complete profile:

   ```json
   {
     "name": "My space"
   }
   ```

   This opens one terminal using the app's default shell and folder.
3. Check **Launch preview** below the editor. It updates as you type, showing pane groups, tabs, and the active tab. If the JSON is invalid, the preview shows the error.
4. Select **Save profile**. If there is an error, check the message beside the buttons and correct the JSON.
5. Under **Launch into**, choose **New space**, **Current space: add panes**, or **Current space: replace layout**. To use an existing space, select it in the sidebar before opening Settings.
6. Select **Launch profile**.

Adding panes keeps the existing layout. Replacing the layout closes its panes and ends their terminal sessions; the app asks for confirmation and warns if Markdown edits are unsaved. A new space uses the profile's name, adding a number if needed to keep space names distinct.

Profiles are saved separately from spaces in the app's local storage. Editing or deleting a profile does not update spaces already launched from it. Use **Duplicate** to start from an existing profile, and **Delete** to remove one.

## A profile with several tools

```json
{
  "name": "Web project",
  "description": "A terminal, project files, and a browser",
  "root": "C:/Projects/my-app",
  "direction": "row",
  "panes": [
    {
      "type": "terminal",
      "title": "Dev server",
      "command": "npm run dev"
    },
    "files",
    {
      "type": "browser",
      "url": "http://localhost:3000",
      "favorites": [
        { "name": "Documentation", "url": "https://developer.mozilla.org" }
      ]
    }
  ]
}
```

Each entry in `panes` opens a pane. A tool can be a simple name (`"terminal"`, `"files"`, or `"browser"`) or an object with a `type` and additional options. The app displays terminal commands for confirmation before running them. Commands run when the profile is launched; they do not rerun when a saved space is restored.

## Profile options

| Option | Meaning | Default |
| --- | --- | --- |
| `name` | Profile name; also used for a new space. Required and cannot be blank. | None |
| `description` | Optional description of the profile. | None |
| `root` | Project folder for a new space. Use a folder that exists on your computer. | Home folder |
| `direction` | `"row"` places pane groups side by side; `"column"` stacks them. | `"row"` |
| `panes` | Array of tools or tab groups, in launch order. Supports 1–20 pane groups. | One terminal |

For an existing space, the space's project folder is used instead of the profile's `root`. In path options, `${workspace}` expands to that folder. Set a project folder when using `${workspace}` so it resolves to the intended location. Forward slashes work in Windows paths; if you use backslashes in JSON, double them, for example `"C:\\Projects\\my-app"`.

The starting layout uses equal-sized splits in one direction. Nested split layouts and custom split sizes are not supported in profile JSON. You can resize or rearrange panes in the space after launch.

## Put multiple tabs in one pane

Use a `tabs` array instead of a single tool. `active` selects the initial tab by number, starting at 1; if omitted, the first tab is active.

```json
{
  "name": "Development",
  "panes": [
    {
      "tabs": [
        { "type": "terminal", "title": "Shell" },
        { "type": "terminal", "title": "Server", "command": "npm run dev" }
      ],
      "active": 1
    },
    "files"
  ]
}
```

A tab group must contain 1–20 tools. The `active` number must point to a tab in that group.

## Terminal options

```json
{
  "type": "terminal",
  "title": "Server",
  "shell": "powershell.exe",
  "cwd": "${workspace}",
  "env": { "NODE_ENV": "development" },
  "command": "npm run dev"
}
```

All fields except `type` are optional. `shell` names the executable to start, `cwd` is its starting folder, and `env` supplies environment variables as string values. `command` is entered into the shell at launch after confirmation. The shell and command must be available on your computer.

## Browser options

```json
{
  "type": "browser",
  "url": "http://localhost:3000",
  "favorites": [
    { "name": "Local app", "url": "http://localhost:3000" },
    { "name": "Docs", "url": "https://developer.mozilla.org" }
  ]
}
```

`url` is the starting address. Each favorite has a `name` and `url` and appears as a button in that browser pane. Both options are optional. A `title` may also be supplied.

## Files options

```json
{
  "type": "files",
  "root": "${workspace}",
  "pins": [
    { "name": "Source", "path": "${workspace}/src" },
    { "name": "Docs", "path": "${workspace}/docs" }
  ],
  "reveal": "${workspace}/README.md"
}
```

`root` sets the pane's initial folder, `pins` adds buttons for folders, and `reveal` opens a file in the preview. Each pin has a `name` and a `path`. These options are optional; the pane otherwise uses the space folder. A `title` may also be supplied.

## Import and export

Select **Import JSON** and choose a `.json` file to add a profile. Select **Export JSON** to save the selected profile to a file for backup or sharing. Save any edits before exporting or launching. Import validates the configuration and reports errors in Settings.

Profiles use JSON, not YAML. JSON requires double quotes around property names and strings, and does not allow comments or trailing commas. Unknown options are rejected. The detailed nested `layout` format from the earlier prototype is not supported by the app; use `panes` and `direction` as described above.
