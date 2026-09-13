# FuelNerve for iOS

The owner companion for FuelNerve. The app is read-first: today’s position, intelligence briefings, alerts and questions, with tightly scoped, explicitly confirmed workflows such as approvals and purchase-invoice capture.

## Generate and run

1. Install XcodeGen (`brew install xcodegen`).
2. From this directory run `xcodegen generate`.
3. Open `FuelNerve.xcodeproj`, choose the required build configuration, and run the `FuelNerve` scheme on an iPhone simulator.

## Environments

- `Local` uses `http://127.0.0.1:4000/api` and the local web app on port 5173.
- `Staging` uses the HTTPS staging host.
- `Production` uses `https://fuel.mindvector.tech/api`.

The URLs and environment name are non-secret Xcode build settings. Passwords, session credentials, signing secrets, and API keys must never be added to these settings. Staging and Production fail closed if configured with a non-HTTPS URL.

Preview data is off by default. For intentional local UI development only, set the `FUELNERVE_USE_PREVIEW_DATA` build setting to `YES` in a local, unshared scheme or command-line build. The app rejects preview mode in Staging and Production.

## Authentication

Live builds use the same `/auth/login`, `/auth/me`, `/auth/change-password`, and `/auth/logout` session flow as the web application. A dedicated FuelNerve URL session retains the server's HTTP-only cookie; the token is never passed into SwiftUI, persisted by application code, or written to logs. The app restores the session on launch, fails closed on an expired or revoked session, and removes local cookies on logout even when the server is unavailable.

The native app loads `/platform/capabilities` after authentication and hides every disabled operation. A second client-side boundary permits only reviewed request paths. Purchase invoice capture performs OCR with Apple Vision on the device, keeps extracted values as an unsaved draft, and requires the user to review and press **Confirm and post invoice**. That one idempotent request is validated and committed transactionally by the server. Unrelated execution paths remain rejected before a request is sent.

Evidence links are resolved against the environment's configured web application URL and opened by the system browser. Only recognized FuelNerve record paths are accepted. Absolute URLs, credentials, query strings, fragments, encoded path tricks, and traversal paths are rejected. The native API session cookie is never copied into a URL or transferred to the browser; when the browser does not already have its own FuelNerve session, the web application asks the user to sign in.

## Contract and security tests

`FuelNerveTests/Fixtures` contains sanitized examples of the authentication, dashboard, briefing, station-context, subscription, and capability responses. It contains no production customer records. The native suite covers cookie lifecycle, contract decoding, forward-compatible optional fields, entitlement behavior, station propagation, access denial, offline and timeout handling, evidence URL validation, read-only enforcement, and sensitive error redaction.

## Architecture

- `App`: lifecycle, dependency composition and root navigation.
- `Core`: networking, authentication and secure storage boundaries.
- `DesignSystem`: FuelNerve colours and reusable presentation.
- `Features`: one folder per owner workflow.
- `Models`: shared mobile view models and API contracts.
- `Resources`: app icons, colours and future localisations.

The app never calculates stock, money or profit locally. Those values must come from the same authoritative API used by the web application.
