# Auto Register

Auto Register is an Electron desktop application built for learning and experimentation. The project demonstrates how to structure an Electron, React, and TypeScript app with provider-based registration flows, local settings, proxy management, and release packaging.

This project is intended for educational use only. Use it responsibly and only with services, accounts, and traffic that you are allowed to test.

## Supported Sites

- TokenLB

## Features

- Desktop app built with Electron, Electron Vite, React, and TypeScript.
- Provider-based architecture for target sites and email inbox providers.
- TokenLB registration workflow support.
- Additional site provider support through the provider registry.
- Email provider support, with Emailnator selected as the default provider.
- Browser profile management for registration sessions.
- Proxy pool management with manual import, TXT/JSON import, ZingProxy import, and free proxy source import.
- Account storage and export.
- API key creation and saved-key export for supported registered accounts.
- Balance lookup for supported saved API keys, with browser-context fallback for protected requests.
- GitHub Actions release workflow for Windows and macOS builds.

## API Key Workflow

The API Keys tab supports creating, updating, exporting, and checking supported API keys for registered accounts.

Registration flow:

- The app opens the selected target site's registration page in the selected browser profile.
- If the target site requires a legal policy checkbox, the checkbox is accepted before filling the form.
- A temporary Emailnator inbox is created and validated.
- The app submits the registration form, waits for the email verification code, and fills the OTP from the received email.
- Successful registrations are saved to Accounts with the browser profile and proxy used for that account.

API key flow:

- Open the `API Keys` tab.
- Select a supported site in the Site filter.
- Select an account and enter a key name.
- Use `Group / Group ID` when the selected site supports key groups.
- Click `Create API Key` to create a key for the selected account.
- The generated key is saved back to the account record and appears in `Accounts` and `API Keys`.
- Existing keys can be updated by group where the selected site supports group updates. This updates the saved key record instead of creating a new key.

Balance flow:

- In the `API Keys` tab, click `Get Balance` on a supported account row.
- The app reads or refreshes the account login token from the saved browser profile.
- It calls the supported site's balance/profile endpoint with the account token.
- If the Node fetch path is blocked, the app falls back to the saved browser profile and fetches from the page context.
- The fetched balance is saved on the account and displayed in the `Balance` column.

Operational notes:

- Site login tokens are read from the saved browser profile when required.
- If automatic login cannot resolve a token, the browser profile is opened so the user can sign in manually and retry.
- The API key and balance flows require the account record to have a browser profile, because the profile stores the site session/token.

## Requirements

- Node.js 20 or newer.
- npm.

## Development

Install dependencies:

```bash
npm ci
```

Start the development app:

```bash
npm run dev
```

Build the app source:

```bash
npm run build
```

## Packaging

Build a Windows installer:

```bash
npm run dist:win
```

Build a macOS package:

```bash
npm run dist:mac
```

Build using the default Electron Builder target for the current platform:

```bash
npm run dist
```

Packaged files are written to the `release` directory.

## GitHub Releases

The release workflow runs when a version tag is pushed:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow builds Windows and macOS packages, creates a GitHub Release, uploads the generated artifacts, and writes release notes from the previous tag to the current build tag.

### macOS Signing

macOS release files must be signed and notarized to open normally after download. Add these GitHub repository secrets to produce notarized macOS artifacts:

- `MAC_CSC_LINK`: Base64-encoded Developer ID Application `.p12` certificate.
- `MAC_CSC_KEY_PASSWORD`: Certificate password.
- `APPLE_ID`: Apple ID email.
- `APPLE_APP_SPECIFIC_PASSWORD`: App-specific Apple ID password.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

If these secrets are missing, the workflow still builds unsigned macOS artifacts. macOS may show that the app is damaged after download. For local testing only, copy the app to `Applications` and remove quarantine:

```bash
xattr -dr com.apple.quarantine "/Applications/Auto Register.app"
```

## Project Structure

- `src/main`: Electron main process, IPC handlers, settings, providers, storage, and proxy logic.
- `src/preload`: Safe bridge between the renderer and main process.
- `src/renderer`: React UI.
- `src/shared`: Shared contracts and types.
- `docs/plan`: Planning and architecture notes.

## Notes

- Free public proxies can be unreliable. Always test imported proxies before running jobs.
- The application currently uses the default Electron icon unless custom icons are added.
- Use this project only with services, accounts, and traffic that you are allowed to test.
