# Cubicle UI style guide

Cubicle uses a compact, quiet dark interface. Reuse the shared tokens at the top of `src/style.css`; avoid introducing new colors for ordinary surfaces, borders, text, or focus states. Existing component-specific colors can remain where they convey meaning.

- Use `--surface-app` for the workspace, `--surface-card` for grouped content, and `--surface-control` for filled controls. Use the matching border and text tokens.
- Use 12px labels and 11px supporting text for dense controls. Keep descriptions short and maintain visible contrast.
- Use `--surface-menu`, `--surface-hover`, and `--shadow-menu` for floating menus. Give menu shells rounded corners and menu rows chip-shaped hover states.
- Use `--radius-control` for compact icon buttons and inputs, `--radius-card` for panels, and `--radius-chip` for navigation chips and compact text actions. Use circular controls only for icons or switches.
- Prefer 28–32px controls, 6–8px gaps, and 8–14px internal padding. Allow wrapping in narrow panes; avoid fixed widths that truncate essential actions.
- Selected items need an explicit visual state; disabled controls need reduced contrast and must not look clickable. Destructive actions should identify their consequence.
- All interactive elements need accessible names, keyboard access, and a visible `--focus-ring` focus indicator. Switches must retain native checkbox behavior. Respect reduced-motion preferences.
- Reuse existing components and selectors before adding variants. Scope styles to the component when a global change could affect pane toolbars, menus, editors, or third-party widgets. Check Settings, dialogs, and narrow widths when changing shared controls.

Keep editor canvases, structural split lines, and docked pane edges square where rounding would interfere with layout. Preserve semantic colors for warnings, destructive actions, and space identities.
