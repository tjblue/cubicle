# Cubicle features and components

Cubicle is a desktop workspace that combines terminals, files, and web pages in saved, customizable layouts.

## Major features

| Feature | What it includes |
| --- | --- |
| **Spaces** | Named workspaces with project folders, colors, saved layouts, search, and sorting. Switching spaces keeps their mounted tools available during the app session. |
| **Panes and tabs** | Horizontal and vertical splits, rearrangeable tabs, named and colored tab groups, and configurable pane appearance. |
| **Terminals** | Multiple shell sessions, copy and paste, clickable file paths, custom tab titles, scrollback, restart controls, and optional confirmation before closing. PowerShell and cmd report directory changes for saved folders and relative links. Profiles can configure the shell, environment, working folder, and startup command. |
| **File browser** | Folder trees, recursive filename search, pinned files with individual removal controls, path copying, a resizable file tree, document reload, and syntax-highlighted text previews with line numbers. |
| **Markdown** | Rendered previews, editing and saving, heading navigation, embedded local images in preview and edit modes, links to local files and web pages, and prompts for unsaved changes. Saving checks for external changes; Reload offers save/discard/cancel before rereading the file. |
| **Embedded browser** | An address and search bar, back/forward/reload controls, favorites, page titles and icons, local HTML viewing, and popup links opening in new tabs. |
| **Browser extensions** | Windows support for importing extensions from Edge or unpacked folders, replacing an installed extension when an import returns the same ID, viewing permissions and status, enabling/disabling, and removal. Extensions use a browser profile separate from the app interface. Some extension features require toolbar buttons or popups that WebView2 does not provide; updates must be imported manually. |
| **Space profiles** | Reusable JSON launch templates defining panes, tabs, folders, shells, environment variables, startup commands, favorites, and pins. Includes a launch preview, create/duplicate/delete controls, and import/export. Profiles can create a space, append panes, or replace the current layout. Startup commands require confirmation and run when the profile is launched. |
| **Terminal attention** | Optional per-terminal alerts for bells and terminal notifications, with tab badges, space badges, and a notification list that navigates to the relevant pane. Typing in a terminal acknowledges its alerts. |
| **Preferences and recovery** | Sidebar sizing and visibility, pane appearance settings, automatic workspace layout and pane-state persistence, unsaved-change checks, recovery options for unreadable saved workspaces, and interface reload/app restart controls. Windows also has tray actions for showing, reloading, restarting, and quitting the app. |

Saved layouts describe how the workspace should reopen. They do not restore a running shell process or its scrollback after the app exits.

Space profile options and examples are available in **Settings > Space profiles**.

## Main code components

| Component | Responsibility and main code |
| --- | --- |
| **App shell and workspace management** | [src/src.js](../src/src.js) coordinates spaces, panes, tab groups, settings, profiles, and recovery. [index.html](../index.html) and [src/style.css](../src/style.css) define the interface. Dockview provides the docking layout. |
| **Terminal interface** | [src/terminal.js](../src/terminal.js) integrates xterm.js with native shell sessions. Supporting modules handle file links, directory capture, and attention events. |
| **Files and documents** | [src/files.js](../src/files.js) manages browsing, search, pins, previews, and Markdown saves. [src/text-preview.js](../src/text-preview.js) uses CodeMirror for code previews; [src/markdown-editor.js](../src/markdown-editor.js) uses Milkdown for Markdown. |
| **Browser integration** | [src/browser.js](../src/browser.js) manages browser controls and pane lifecycle. [src-tauri/src/browser.rs](../src-tauri/src/browser.rs) manages native webviews, navigation, and WebView2 extension operations. |
| **Extension management** | [src/extensions-settings.js](../src/extensions-settings.js) provides the settings interface. [src-tauri/src/extensions.rs](../src-tauri/src/extensions.rs) handles discovery, import, records, and removal. |
| **Profiles and saved state** | [src/profiles.js](../src/profiles.js) validates launch templates. [src/workspace-safety.js](../src/workspace-safety.js) handles workspace storage helpers and unsaved-change checks. Workspace and preference data use local storage. |
| **Desktop backend** | [src-tauri/src/main.rs](../src-tauri/src/main.rs) provides Rust/Tauri commands for PTY processes, filesystem access, clipboard, folder dialogs, and app lifecycle. [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) configures the desktop host. |

The frontend uses JavaScript, HTML, and CSS with Vite. The desktop host uses Rust and Tauri, with portable-pty for shell processes and WebView2 on Windows.

See the [UI style guide](ui-style-guide.md) for interface conventions and the [README](../README.md) for development commands.

The November 2026 review and repair results are recorded in [feature review](feature-review.md) and [repair status](feature-repair-status.md).
