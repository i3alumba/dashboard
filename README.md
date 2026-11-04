# React + TypeScript + Vite

## Central Auth session

Sign-in uses Auth's CSRF-protected Django session endpoints with credentials
included. An existing Auth session opens Dashboard without another password;
the page obtains a JWT pair only through the protected session bridge. Tokens
never appear in redirect URLs. Legacy JWT API clients remain supported.

The portal uses `/api/access/` and displays only explicitly enabled services,
not URLs inferred from group names. Resource Monitor at
`https://monitor.i3alumba.ru` appears only for exact `services.monitor.enabled=true`
from Auth: active staff administrators, independently of native service groups.
The monitor itself revalidates access server-side on every data request; hiding
this card is not an authorization boundary.
Ubuntu Hosting at `https://hosting.i3alumba.ru` follows exact
`services.hosting.enabled=true` in the same Auth response and appears in the
same service-tile grid, not as a separate control. The prepared hosting API checks
live active status and exact `services.hosting` on every request; a visible tile
is not authority. Before Hosting readiness, Auth retains legacy staff-derived
eligibility. Deploy and verify the consumer before enabling independent grants.
Rotated refresh tokens are persisted and concurrent expired requests share one
refresh. Logout ends the Auth browser
session and revokes the current owned refresh token, then clears local JWT
cookies. Existing sessions in GitLab, Matrix, Jenkins and MinIO are not globally
terminated; this is SSO, not back-channel single logout.

`npm run test:theme` runs both theme and mocked session/CSRF/refresh regression
tests. No production credentials or services are used.

## Service tiles

Enabled services appear as large, fully clickable links with distinct decorative
icons: one column on mobile, two on tablets and three on desktop (six services
form two desktop rows). Tiles gently lift on hover and keyboard focus, with a
clear focus outline in both themes. Reduced-motion preferences disable movement
and transitions while preserving the static focus indicator. Auth grants, labels
and destination URLs are unchanged. Mocked browser tests cover all six tiles,
responsive layout, keyboard navigation, hover and reduced motion.

## Color theme

Use the sun/moon button in the Dashboard header to switch between light and dark
mode. It is available on the login screen as well as authenticated pages.
Initially the theme follows the operating system. An explicit selection is shared
with i3alumba services using the non-sensitive `i3alumba-theme` cookie (on
`i3alumba.ru`, Secure on HTTPS, SameSite=Lax). The shared cookie takes priority
over same-origin `i3alumba-color-mode` storage; an existing `dashboard-color-mode`
preference migrates when no shared choice exists. Open tabs synchronize through
storage events and sibling domains through one-second cookie polling and focus.
If cookies or storage are blocked, available storage or memory keeps the switch
usable. Authentication cookies and session behavior are unchanged.

### Theme regression tests

```bash
npm ci
npx playwright install chromium
npm run test:theme
npm run lint
npm run build
```

An existing Chromium installation can be used instead of downloading a browser:
`CHROMIUM_PATH=/usr/bin/google-chrome-stable npm run test:theme`.
Tests mock authentication API responses and do not contact production services.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      ...tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      ...tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      ...tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.node.json", "./tsconfig.app.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
]);
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from "eslint-plugin-react-x";
import reactDom from "eslint-plugin-react-dom";

export default tseslint.config([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs["recommended-typescript"],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.node.json", "./tsconfig.app.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
]);
```

## User administration (disabled source preparation)

The same bundle renders `https://users.i3alumba.ru/` and the portal's normal
User administration card. Active global administrators are checked by Auth on
every API call; the page uses same-origin `/api/user-admin/`. The central API
release switch defaults off. No native worker or credentials are included.

The staged central-only mode requires a typed `native_scheduling_enabled`
capability from Auth. False shows explicit deferred provisioning, keeps central
permission editing available and hides native handoff controls. Missing/malformed
capabilities fail closed rather than claiming that an older backend cannot queue
native work. Release the matching Auth backend before this Dashboard; neither
this UI nor the scheduling flag activates a worker or external credentials.

The provisioning-first MVP distinguishes requested access, preparing/bound setup,
configured accounts with unconfirmed session guarantees, and deferred revocation.
It explicitly warns that removing access or deactivating denies new Auth sign-ins
but may leave external credentials working. Re-enable requiring operator attention
is never shown as successful. The worker's narrower scope does not clear activation
gates; the UI contains no execution bypass.

The matrix has one `is_admin` column, per-service grants, create, profile editing
(email/first/last name), confirmation for role/deactivation changes, and native
status. Owned GitLab/Matrix/MinIO targets also expose explicit pause/resume
handoff. Confirmations keep their opening authority epoch across polling, not a
profile ETag. Resume is disabled for running/unknown reservations and another
administrator's pause; safe manual changes are conditional on the pause staying
in effect. Authority loss closes these dialogs too. No force/retry or Jenkins
management action exists. Username/native IDs are not renamed; users are never deleted. Profile
edits retain their opening ETag across polling and reject concurrent updates.
Loss of authority clears the table and any open profile/confirmation dialog;
late responses cannot restore them. Create passwords remain DOM-only and are
cleared at submit. Jenkins is hard-readonly and never managed. Hosting stays
readonly until the prepared server-side consumer contract is deployed and verified.
The administrator-only MinIO scope note records the operator-approved option 1:
blocking newly managed accounts denies S3 access, not native STS/Console-session
issuance. It never claims full login revocation or adoption of existing accounts;
the note disappears with all user data on loss of authority.
The separate Matrix note records its independently accepted native lock semantics:
password login/sync are denied while refresh may rotate tokens that remain denied;
sessions and keys are preserved. This is not permanent revocation or worker activation.
The GitLab note distinguishes cookie identity introspection from private data
access and explicitly retains the browser/OIDC acceptance gate. Auth's separate
worker source defaults to preview and all profiles remain activation-blocked;
Dashboard contains no native credentials.

`npm run test:theme` includes isolated Users API mocks, profile conflicts,
authority loss, SSO restoration, native handoff epoch/reservation checks and mobile
matrix scrolling. The complete latest mocked Chromium suite passed 98 tests. No production
requests are made. Security fixes are locked within the existing dependency
ranges; production dependency audit reports zero advisories. The development
ESLint dependency tree still has 12 moderate minimatch advisories; fixing that
requires a separate compatible lint-tooling migration, not `npm audit --force`.

## Ubuntu Hosting administrator UI

The prepared standalone origin is `https://hosting.i3alumba.ru/`, with the existing
JWT client using same-origin `/api/containers/`. The same frontend bundle/service
renders the hosting panel at that origin and the portal grid at `main.i3alumba.ru`.
The old portal `/containers` path redirects to the fixed Hosting root, dropping
query strings rather than forwarding credentials. `/containers` remains a local
development/test route; Hosting canonicalizes it to `/`.

The portal entry follows the exact live Auth `services.hosting.enabled` grant;
inventory and mutations independently require exact backend capabilities and
server-side bearer authorization. Missing/malformed grants and authorization loss
clear the panel. Capabilities refresh on focus and every five seconds.
The migration requires reviewed Host-specific Ingress and Auth's exact Hosting
CORS/CSRF origin, not wildcard guest origins. Source preparation is not deployment.

The server enforces the live administrator role on every request, CPU/RAM limits,
a single valid DNS label under `hosting.i3alumba.ru`, and atomic port inspection/reservation.
The Subdomain input defaults to `mc`, yielding `mc.hosting.i3alumba.ru`.
Wildcard/exact DNS records must be DNS-only for arbitrary TCP/UDP; this UI does
not create/change them. Other suffixes, nested labels and URLs are rejected. Browser checks are only
advisory, not reservations or authorization. Free/reserved/published allocation
and service reachability are distinct; unknown host inspection is never free.
Guests are plain Ubuntu with persistent full root and separate `/home` on SSD,
without disk quota; shared disk exhaustion remains an operator risk. Passwords
are write-only, masked, cleared on submission, and never persisted by this UI.
Password-manager `input`/focus/blur events synchronize validation booleans without
putting plaintext passwords into React state. The current DOM value is rechecked
at submit. A disabled Create button lists the invalid constraints instead of
silently treating a filled but invalid field as complete.
Only owned port removal is offered, not guest deletion or recreation.

SSH suggests `3001 → 22`, within the operator-confirmed **3000–50000** forwarded
range. Infrastructure and NodePort30000–32767 remain excluded; every new port
still needs actual host/NAT inspection and atomic server reservation. A suggestion
is never a grant. Alpha's old2222 remains GitLab SSH, outside this allocation pool.
Guest target ports may include22. Root passwords
must be 16–256 characters without CR/LF/NUL/colon and are never returned.

Capabilities explicitly declare `external_ingress_ready`. False means upstream
router/NAT forwarding is not configured: show an operator warning and disable
public-port creation/addition, while preserving inventory/removal/power controls.
Free host sockets alone cannot prove that a port is routed from the internet.
