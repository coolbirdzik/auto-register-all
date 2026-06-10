# Auto Register

A small Electron + React + TypeScript desktop app that automates account registration on a few AI API gateway sites and helps manage the resulting API keys.

This is a learning project. Use it only with services and accounts you are allowed to test, and treat it as a playground for studying Electron, browser automation, and provider-based architectures.

## What it does

- Registers accounts on supported sites (TokenLB, WeiLai, AI-ROUTER) using a temporary email inbox.
- Saves accounts, browser profiles, and proxies locally.
- Creates and manages API keys for registered accounts, including bulk creation, group updates, balance lookup, and TXT export.
- Supports light and night themes.

## Quick start

Requires Node.js 20+ and npm.

```bash
npm ci
npm run dev
```

Build a production bundle:

```bash
npm run build
```

Package an installer for the current platform:

```bash
npm run dist
```

Output goes to the `release/` directory.

## Project layout

- `src/main` - Electron main process, IPC handlers, providers, storage, proxy logic.
- `src/preload` - Bridge between renderer and main.
- `src/renderer` - React UI.
- `src/shared` - Shared TypeScript contracts.

## Contributing

Contributions are welcome. This project exists for learning, so feel free to open issues or pull requests with fixes, new site providers, UI tweaks, or improvements of any size. Small PRs are perfectly fine.

## Disclaimer

For educational use only. You are responsible for following the terms of service of any site you interact with.
