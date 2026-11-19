# Cubicle

Cubicle is a Tauri workspace for terminal, file, and browser panes.

On Windows, Settings → Browser extensions can import an unpacked extension folder or discover extensions in an Edge profile. Open a browser pane before installing, enabling, disabling, or removing an extension. Imports are copied into Cubicle's data directory and use a separate browser profile. WebView2 does not provide the usual browser toolbar and popup entry points, so some extensions may not work fully. Extension updates must currently be imported manually.

## Development

Install Node.js, Rust, and the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/), then run from this folder:

```powershell
npm install
npm run desktop:dev
```

Run `npm run desktop:build` to build the desktop executable. On Windows, the output is `src-tauri/target/release/cubicle.exe`; the build does not create an installer.

For frontend development, `npm run dev` serves the interface at http://127.0.0.1:4179. Desktop features such as terminals and filesystem access require the Tauri app. Run the JavaScript tests with `npm test` and build the frontend alone with `npm run build`.

See [features and components](docs/features.md) for an app overview and the [UI style guide](docs/ui-style-guide.md) for interface conventions. Space profile options and examples are available in Settings > Space profiles.
