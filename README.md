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
this card is not an authorization boundary. Rotated refresh tokens are persisted and
concurrent expired requests share one refresh. Logout ends the Auth browser
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

## Ubuntu container administrator UI (unreleased)

`/containers` uses the existing JWT client against same-origin `/api/containers/`.
The entry and inventory require exact live backend administrator capabilities;
missing/malformed grants and authorization loss clear the panel. Capabilities are
rechecked on focus, refresh and every five seconds. Backend routing/publication
is separate work; nothing has been released or deployed by this UI change.

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
