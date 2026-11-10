# Cubicle

Cubicle is a Tauri workspace for terminal, file, and browser panes.

## Development

Install Node.js, Rust, and the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/), then run from this folder:

```powershell
npm install
npm run desktop:dev
```

Run `npm run desktop:build` to build the desktop executable. On Windows, the output is `src-tauri/target/release/cubicle.exe`; the build does not create an installer.

For frontend development, `npm run dev` serves the interface at http://127.0.0.1:4179. Desktop features such as terminals and filesystem access require the Tauri app. Run the JavaScript tests with `npm test` and build the frontend alone with `npm run build`.

See the [app guide](docs/recovered-app-readme.md) for features and [space profiles](docs/guides/space-profiles.md) for reusable workspace configuration.
