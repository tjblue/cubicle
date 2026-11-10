# Cubicle

Cubicle is a Tauri workspace for terminal, file, and browser panes.

## Development

Cubicle is undergoing an experimental migration from Tauri 2 to Tauri 3 alpha. Windows uses the system WebView2 runtime; Linux and macOS use the CEF webview runtime. Install Node.js, Rust 1.95 or newer, and the platform's [Tauri prerequisites](https://v3.tauri.app/start/prerequisites/). CEF also requires CMake and Ninja on macOS, plus about 1 GB of disk space for its first platform-specific download. See the [app guide](docs/recovered-app-readme.md) for platform notes and current validation status.

Then run from this folder:

```powershell
npm install
npm run desktop:dev
```

Run `npm run desktop:build` to build the desktop executable. This command uses `tauri build --no-bundle`: it does not create an installer or exercise final package assembly. Do not treat a successful executable build as validation of packaged releases. CEF support and this migration are experimental; no platform is currently documented as validated.

For frontend development, `npm run dev` serves the interface at http://127.0.0.1:4179. Desktop features such as terminals and filesystem access require the Tauri app. Run the JavaScript tests with `node --test tests/*.test.js` and build the frontend alone with `npm run build`.

See the [app guide](docs/recovered-app-readme.md) for features and [space profiles](docs/guides/space-profiles.md) for reusable workspace configuration.
