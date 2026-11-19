# Feature review — November 18, 2026

**Update:** The repair pass is recorded in [feature repair status](feature-repair-status.md). Findings below describe the code as originally reviewed.

Four subagents reviewed all ten features listed in `docs/features.md`, tracing the frontend, relevant Rust commands, and existing tests. This is a review, not an implementation change.

The highest priority is preserving work during recovery. Next are file refresh/conflict handling, terminal lifecycle and working-directory tracking, and reliable extension/profile operations.

## Coverage

| Feature | Assessment |
| --- | --- |
| Spaces | Recovery-mode switching can discard newly opened panes and unsaved edits. See R1. |
| Panes and tabs | No independent defect substantiated in splitting, rearrangement, or group name/color handling. Browser overlap with tab-group menus needs a desktop check; see U1. |
| Terminals | Reload leaves unmanaged sessions; Windows working directories can become stale; absolute paths containing spaces are parsed incorrectly. See R2–R4. |
| File browser | Selected documents cannot be reloaded directly, and missing pinned files cannot be removed. See R5–R6. |
| Markdown | Local-image handling and heading uniqueness have gaps. Conflict recovery also suffers from R5. See R7–R9. |
| Embedded browser | The displayed address can remain stale after a redirect. See R10 and U1. |
| Browser extensions | Concurrent UI actions can be dropped, same-ID updates are rejected, and the profile picker expects a different folder level. See R11–R13. |
| Space profiles | Several operations hide persistence failures; custom file-tab titles are overwritten. See R14–R15. |
| Terminal attention | No confirmed defect in bell/notification routing or disposal. Acknowledgment, notification text, and background-only behavior are useful improvements. |
| Preferences and recovery | Recovery can lose live panes; incomplete saved-state validation can bypass recovery and interrupt startup. See R1 and R16. |

## Findings

Severity describes user impact. “Reproduced” below means a focused test of the actual JavaScript code with mocked surrounding services, unless stated otherwise. Rust/native findings are explicitly identified as code inspection.

### R1 — High: switching spaces during recovery can discard live work

**Features:** Spaces; Preferences and recovery.

After unreadable workspace data triggers recovery, workspace saving is locked. Open a new Markdown or terminal pane, then switch to another space. `saveActiveSpace()` returns before recording the live layout. `switchSpace()` retains only pane IDs from the old saved layout, so the newly opened pane is missing from the retention set. The removal handler closes it without an unsaved-change check.

**Impact:** Unsaved Markdown can be discarded and live terminals closed while the app is in its recovery mode.

**Fix:** Always maintain the in-memory layout and retain the live panel IDs. Lock only writes to the protected saved workspace.

**Evidence:** Reproduced by executing the real switch/removal handlers with storage locked; the dirty file pane was closed.

**Code:** [src.js:469](C:/Users/lbltyler/dev/cubicle/src/src.js:469), [src.js:542](C:/Users/lbltyler/dev/cubicle/src/src.js:542), [src.js:695](C:/Users/lbltyler/dev/cubicle/src/src.js:695).

### R2 — Medium: interface reload leaves old terminal sessions unmanaged

**Feature:** Terminals.

Open an idle terminal and use **Reload interface**. Reload closes the native browser views but does not close terminal sessions. The Rust registry survives the interface reload, while the new frontend generates new runtime IDs and creates replacement shells. There is no reattachment path. An idle old reader cannot reach its cleanup until output or EOF arrives.

**Impact:** Old shells can remain inaccessible while replacement shells are running. Repeated reloads can accumulate unmanaged sessions.

**Fix:** Explicitly close and await terminal cleanup before reload, or implement reattachment with stable session identities.

**Evidence:** Frontend/backend lifecycle code inspection. Native process behavior was not exercised.

**Code:** [src.js:1008](C:/Users/lbltyler/dev/cubicle/src/src.js:1008), [main.rs:60](C:/Users/lbltyler/dev/cubicle/src-tauri/src/main.rs:60), [terminal.js:26](C:/Users/lbltyler/dev/cubicle/src/terminal.js:26).

### R3 — Medium: Windows working directories become stale without shell integration

**Feature:** Terminals.

In a Windows shell that does not independently emit OSC 7 directory updates, run `cd`, then click a relative file link or quit and reopen Cubicle. Native directory lookup returns `None` outside Linux, and Cubicle does not install directory-reporting shell integration.

**Impact:** Relative links resolve against the old folder, and the reopened terminal uses the old saved folder.

**Fix:** Add working-directory reporting for supported Windows shells and persist reported changes.

**Evidence:** The non-Linux backend branch unconditionally returns `None`. A direct capture probe confirmed that a null lookup leaves the old directory unchanged.

**Code:** [main.rs:95](C:/Users/lbltyler/dev/cubicle/src-tauri/src/main.rs:95), [terminal.js:32](C:/Users/lbltyler/dev/cubicle/src/terminal.js:32), [terminal-directory-capture.js:6](C:/Users/lbltyler/dev/cubicle/src/terminal-directory-capture.js:6).

### R4 — Medium: absolute terminal file paths containing spaces are split

**Feature:** Terminals.

The path `C:/Users/Jane Doe/project/main.js:12:3` produces two links: `C:/Users/Jane` and `Doe/project/main.js:12:3`.

**Impact:** Clicking a common Windows path fails or opens an unintended location.

**Fix:** Recognize quoted paths and common compiler/traceback path formats containing spaces.

**Evidence:** Reproduced by calling the real `findFileLinks()` helper.

**Code:** [terminal-links.js:2](C:/Users/lbltyler/dev/cubicle/src/terminal-links.js:2).

### R5 — Medium: selected documents cannot be refreshed or retried directly

**Features:** File browser; Markdown.

Open a file, modify it externally, then click it again or refresh the folder. `openFile()` returns immediately for the selected path; Refresh reloads only directory entries. The same problem prevents retrying a selected file whose first preview failed.

**Impact:** The displayed document remains stale. After an external-change save conflict, reopening the file requires navigating away first.

**Fix:** Add a document Reload action with unsaved-change confirmation and permit retry after a failed preview.

**Evidence:** Reproduced: opening, reopening, refreshing, and reopening again invoked `preview_file` only once.

**Code:** [files.js:158](C:/Users/lbltyler/dev/cubicle/src/files.js:158), [files.js:278](C:/Users/lbltyler/dev/cubicle/src/files.js:278).

### R6 — Medium: deleted or moved pinned files cannot be unpinned

**Feature:** File browser.

Pin a file, delete or move it outside Cubicle, and click the pin. Each pinned row has only an Open action. The only unpin action requires that file to be selected, but opening a missing file fails before selection.

**Impact:** Broken pins remain in the saved list without a direct removal action.

**Fix:** Give each pinned row its own Remove action, independent of file existence.

**Evidence:** Reproduced with a missing pin; opening failed and the pin remained with no removal control.

**Code:** [files.js:188](C:/Users/lbltyler/dev/cubicle/src/files.js:188), [files.js:199](C:/Users/lbltyler/dev/cubicle/src/files.js:199).

### R7 — Medium: local Markdown images with encoded filenames fail

**Feature:** Markdown.

For `![Example](images/my%20image.png)`, image loading decodes Cubicle's internal wrapper but passes the original `%20` to the filesystem resolver. It looks for a literal `my%20image.png`. Using a literal-space destination instead is rejected by the URL sanitizer.

**Impact:** Embedded local images with spaces or other encoded characters in their names cannot be displayed through this path.

**Fix:** Separate the URL path from its query/fragment and decode the path before filesystem resolution, retaining the existing scheme checks.

**Evidence:** Reproduced the sanitization/resolution inputs; no native rendering was required to demonstrate the incorrect filename.

**Code:** [files.js:70](C:/Users/lbltyler/dev/cubicle/src/files.js:70), [markdown-safety.js:4](C:/Users/lbltyler/dev/cubicle/src/markdown-safety.js:4).

### R8 — Medium: local-image resolution is absent in Markdown editing

**Feature:** Markdown.

The read-only preview resolves local images through native file access and blob URLs. Entering Edit destroys that preview and creates an editor without the same image-loading path. Relative image URLs then resolve against the application origin.

**Impact:** Images supported in the preview can stop displaying while editing.

**Fix:** Support local-image display in both modes while preserving the original Markdown destination when saving.

**Evidence:** Code inspection and an instrumented harness confirm resolution runs only for preview. Actual Milkdown/native rendering remains unverified.

**Code:** [files.js:163](C:/Users/lbltyler/dev/cubicle/src/files.js:163), [files.js:254](C:/Users/lbltyler/dev/cubicle/src/files.js:254), [markdown-editor.js:17](C:/Users/lbltyler/dev/cubicle/src/markdown-editor.js:17).

### R9 — Low: generated Markdown heading IDs can collide

**Feature:** Markdown.

Headings `Foo`, `Foo-1`, and `Foo` generate IDs `foo`, `foo-1`, and `foo-1`. Duplicate handling counts base names without checking whether a generated ID is already used.

**Impact:** A link to the duplicate anchor selects the first matching heading.

**Fix:** Track every assigned ID and increment the suffix until it is unique.

**Evidence:** Reproduced with the real heading-ID helper.

**Code:** [markdown-safety.js:40](C:/Users/lbltyler/dev/cubicle/src/markdown-safety.js:40), [files.js:249](C:/Users/lbltyler/dev/cubicle/src/files.js:249).

### R10 — Medium: browser address text can remain stale after navigation

**Feature:** Embedded browser.

If a redirect or navigation URL arrives while the address input is focused, the stored URL updates but the input does not. Blurring the input never reconciles it.

**Impact:** The displayed address can disagree with the current page; submitting the stale text can navigate back to the old address.

**Fix:** Track whether the user has actually edited the address and reconcile on blur or committed navigation.

**Evidence:** Reproduced against the real module: saved state changed to `/redirected`, while the displayed input stayed at `/start` after blur.

**Code:** [browser.js:17](C:/Users/lbltyler/dev/cubicle/src/browser.js:17), [browser.js:69](C:/Users/lbltyler/dev/cubicle/src/browser.js:69).

### R11 — Medium: extension toggles can silently fail during other operations

**Feature:** Browser extensions.

Start Edge discovery, then toggle an installed extension. The switch remains interactive, but `run()` silently returns while busy. The switch changes visually without invoking the backend, and discovery completion does not correct it.

**Impact:** The UI can indicate an extension is disabled while it remains enabled.

**Fix:** Disable affected controls while busy, or queue changes and reconcile their state after completion.

**Evidence:** Reproduced against the real module; no `extensions_set_enabled` call occurred.

**Code:** [extensions-settings.js:32](C:/Users/lbltyler/dev/cubicle/src/extensions-settings.js:32), [extensions-settings.js:64](C:/Users/lbltyler/dev/cubicle/src/extensions-settings.js:64).

### R12 — Medium: importing an update with the same extension ID is rejected

**Feature:** Browser extensions.

Import a newer extension version that retains an installed extension's ID. The duplicate-ID branch reinstalls the old directory, deletes the new copy, and returns “already installed.”

**Impact:** There is no direct same-ID update path despite the documentation directing users to import updates manually. Users must remove the existing installation first.

**Fix:** Add an explicit update/replace operation with rollback and preservation of the enabled state.

**Evidence:** Confirmed in the backend branch; native installation was not run. This finding specifically concerns imports returning an existing ID.

**Code:** [extensions.rs:124](C:/Users/lbltyler/dev/cubicle/src-tauri/src/extensions.rs:124).

### R13 — Medium: the Edge profile picker expects the wrong folder level

**Feature:** Browser extensions.

Choose an actual Edge profile directory, such as `Profile 1`, using **Choose profile folder**. Discovery scans that directory for extension IDs directly, but those IDs are under its `Extensions` subfolder.

**Impact:** A valid profile selection reports no extensions.

**Fix:** Accept either a profile directory or its `Extensions` directory; make the picker title consistent.

**Evidence:** Frontend/backend code inspection.

**Code:** [extensions-settings.js:96](C:/Users/lbltyler/dev/cubicle/src/extensions-settings.js:96), [extensions.rs:188](C:/Users/lbltyler/dev/cubicle/src-tauri/src/extensions.rs:188).

### R14 — Medium: profile operations can hide failed persistence

**Feature:** Space profiles.

New, Duplicate, Delete, and Import ignore a failed `persistProfiles()` result. Rendering clears the storage error; Import explicitly replaces it with “Profile imported.”

**Impact:** Changes appear saved but disappear or revert after restart.

**Fix:** Commit the UI operation only after a successful save, or preserve dirty state and an actionable error.

**Evidence:** Reproduced the import handler with a failing persistence stub; its final status was “Profile imported.”

**Code:** [src.js:965](C:/Users/lbltyler/dev/cubicle/src/src.js:965).

### R15 — Low: custom file-pane titles in profiles are overwritten

**Feature:** Space profiles.

A files tab with `"title": "Project Notes"` initially receives that title, but initialization immediately changes it to “Files.”

**Impact:** A valid profile option does not survive launch.

**Fix:** Preserve an explicit profile title.

**Evidence:** Reproduced by executing the actual `showFiles()` code.

**Code:** [src.js:135](C:/Users/lbltyler/dev/cubicle/src/src.js:135), [src.js:987](C:/Users/lbltyler/dev/cubicle/src/src.js:987).

### R16 — Medium: malformed saved metadata can bypass recovery and break startup

**Feature:** Preferences and recovery.

A saved space with valid ID/name but `"path": 42` passes workspace validation. Rendering calls `path?.startsWith(...)`, which throws outside the recovery boundary.

**Impact:** Initialization stops before later settings/recovery handlers register.

**Fix:** Validate optional saved metadata and keep normalization/rendering errors inside the recovery boundary.

**Evidence:** Reproduced using the real workspace validator and path formatter.

**Code:** [workspace-safety.js:3](C:/Users/lbltyler/dev/cubicle/src/workspace-safety.js:3), [src.js:462](C:/Users/lbltyler/dev/cubicle/src/src.js:462), [src.js:567](C:/Users/lbltyler/dev/cubicle/src/src.js:567).

## Desktop verification candidate

### U1 — Tab-group menus may be covered by the native browser view

**Features:** Panes and tabs; Embedded browser.

Right-clicking a browser tab creates an HTML menu extending over the native browser area. The browser visibility gate checks dialogs, settings, and app menus, but does not check the tab-group menu.

The missing condition is confirmed in code; actual occlusion must be checked in the desktop app. If reproduced, use the same hide/restore mechanism already used for other overlays.

**Code:** [browser.js:90](C:/Users/lbltyler/dev/cubicle/src/browser.js:90), [src.js:196](C:/Users/lbltyler/dev/cubicle/src/src.js:196).

## Worthwhile additions after the functional fixes

| Addition | Why it is useful |
| --- | --- |
| Markdown conflict actions: Compare with disk, Reload, Save copy | Turns existing protective conflict detection into a recoverable editing workflow. |
| Save current space as a profile | Avoids manually reconstructing a working layout in JSON. |
| Restore/import a workspace backup | Completes the existing recovery backup-download workflow. |
| Initialize/repair the extension browser profile from Settings | Avoids requiring navigation in a browser pane before management operations; gives missing installations a repair path. |
| Project-aware filename search | Ignore configured dependency/generated directories and make the search budget adjustable or resumable. |
| Terminal link navigation to line/column, plus scrollback search | Makes terminal output more useful for everyday debugging. Line/column information is currently stripped before opening a file. |
| Better terminal-attention acknowledgment | Acknowledge on focus/input, optionally notify only for background terminals, and include notification text in the list. Current routing marks even the active terminal and typing does not clear its badge. |
| Persist file-tree width and expanded folders | Keeps useful browsing context when panes are recreated. |

## Suggested implementation order

1. **Protect work and recovery:** R1, R16, R14.
2. **Repair common editing/navigation workflows:** R5, R6, R7, R8, R10.
3. **Make lifecycle and management reliable:** R2, R3, R4, R11, R12, R13.
4. **Finish smaller inconsistencies:** R9, R15, and verify U1.
5. Add the highest-value workflow improvements above.

Regression coverage should emphasize recovery-mode switching with dirty files, failed storage writes, repeated reloads, external file changes, redirects while editing the address bar, and extension actions during pending operations.

## Validation and limits

- All **34 existing JavaScript tests passed** with in-process execution. The normal `npm test` worker launch was blocked by this environment's `spawn EPERM` restriction.
- Reviewers also ran focused in-memory probes against actual modules/functions. Native interfaces and parts of the DOM were mocked.
- `npm run build` could not run because frontend dependencies are not installed (`vite` unavailable).
- Rust tooling was unavailable on `PATH`; no Rust build/tests or live Tauri/WebView2/PTY checks were performed.
- Application source files were not changed. Absence of a finding is not an end-to-end certification of a feature.
