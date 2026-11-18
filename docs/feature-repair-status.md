# Feature repair status — November 18, 2026

The repairs below implement the findings in [the feature review](feature-review.md). Subagents handled workspace/profile safety, file/Markdown workflows, browser/extensions, and terminal helpers. A separate integration review checked how the changes interact.

## Implemented repairs

| Finding | Result |
| --- | --- |
| R1 — Recovery-mode space switching | Live layouts are still captured in memory while writes to protected saved data are blocked. Switching spaces retains newly opened panes and their unsaved work. |
| R2 — Terminal cleanup during reload | Reload waits for pending terminal starts and closes all native terminal sessions, including stale sessions. Cleanup errors cancel reload; surviving terminals remain usable and browser panes are restored. |
| R3 — Windows working directories | Session-local PowerShell/cmd prompt integration reports the current directory. Reports update saved pane state immediately, including paths with spaces, percent signs, and hash characters. |
| R4 — Spaced terminal links | The link parser recognizes quoted and common absolute paths containing spaces without splitting them into separate links. |
| R5 — Document reload and retry | A document Reload button offers save/discard/cancel for unsaved changes. Failed previews can be retried by selecting the same file. Save conflicts preserve edits and cancel navigation. |
| R6 — Broken pins | Every pinned row has its own removal button, including missing files. |
| R7 — Encoded local images | Image paths separate query/fragment components before decoding the filename and retain unsafe-scheme checks. |
| R8 — Images while editing | Local images use the same loading path in preview and edit modes. Display URLs do not replace original Markdown destinations; replaced/disposed images release their blob URLs. |
| R9 — Heading anchors | Generated IDs are checked against every assigned ID, including names already containing numeric suffixes. |
| R10 — Browser address display | Redirects update an untouched address field even while focused. Actual edits are preserved until navigation or blur reconciles the address. |
| R11 — Extension controls while busy | Pending operations disable affected controls and restore their proper availability afterward. Successful toggles remain reflected if a subsequent list refresh fails. |
| R12 — Same-ID extension updates | Imports returning an existing ID replace its record, preserve the enabled state, and roll back the runtime on configuration/persistence failure. Failed rollback or an ambiguous installation timeout retains files and reports their location. |
| R13 — Edge profile selection | Discovery accepts either the selected profile directory or its Extensions subdirectory. The picker states which folder to choose. |
| R14 — Profile persistence errors | New, Duplicate, Delete, Import, and Save commit UI changes only after successful persistence. Failures preserve selection, edits, and the error message. |
| R15 — Profile file-tab names | File panes retain their explicit profile titles. |
| R16 — Saved metadata validation | Workspace loading validates optional metadata, layout shapes, and unique nonblank IDs before rendering; malformed data enters recovery. |
| U1 — Native browser over tab menus | Opening a tab-group menu hides native browser views; closing it restores visibility. |

Typing also acknowledges terminal attention badges.

## Validation

All **79 JavaScript tests pass**. They exercise the repaired paths using actual modules/functions with mocked DOM/native services, including delayed startup/navigation, unsaved edits, failed saves and cleanup, redirect timing, asynchronous image disposal, and busy extension controls. Run them in this environment with:

```powershell
node --experimental-vm-modules --test --test-isolation=none tests/*.test.js
```

JavaScript syntax checks passed. The standard worker-based test invocation is restricted by this environment, so the suite runs in one process.

Rust unit tests were added for shell setup, extension replacement/rollback, folder cleanup boundaries, and Edge profile discovery. Direct Windows PowerShell/cmd probes verified directory reporting and preservation of custom prompt/exit status.

**Remaining validation:** Rust compilation/tests and a live Tauri/WebView2 pass have not run because Rust tooling is unavailable. The frontend production build is also blocked because Vite dependencies are unavailable and package installation could not complete. Native extension replacement, desktop image rendering, terminal reload cleanup, and overlay visibility require desktop verification before release.

If reload is cancelled after native browser cleanup, restored browser panes reopen their last URLs. Page history and unsaved webpage form state cannot be restored after the native view has closed.

## Follow-up additions

The larger additions remain separate from this repair pass:

- Markdown conflict comparison and Save copy; Reload is now implemented.
- Save the current space as a profile.
- Restore/import a workspace backup.
- Initialize or repair the extension browser profile from Settings.
- Configurable project search exclusions and search limits.
- Terminal links that navigate to a line/column, and scrollback search.
- Optional background-only attention alerts and notification text.
- Persist file-tree width and expanded folders.
