# React + TypeScript + Vite

## Central Auth session

Sign-in uses Auth's CSRF-protected Django session endpoints with credentials
included. An existing Auth session opens Dashboard without another password;
the page obtains a JWT pair only through the protected session bridge. Tokens
never appear in redirect URLs. Legacy JWT API clients remain supported.

The portal uses `/api/access/` and displays only explicitly enabled services,
not URLs inferred from group names. Rotated refresh tokens are persisted and
concurrent expired requests share one refresh. Logout ends the Auth browser
session and revokes the current owned refresh token, then clears local JWT
cookies. Existing sessions in GitLab, Matrix, Jenkins and MinIO are not globally
terminated; this is SSO, not back-channel single logout.

`npm run test:theme` runs both theme and mocked session/CSRF/refresh regression
tests. No production credentials or services are used.

## Color theme

Use the sun/moon button in the Dashboard header to switch between light and dark
mode. It is available on the login screen as well as authenticated pages.
Initially the theme follows the operating system. An explicit selection is saved
in this browser under `dashboard-color-mode` and synchronized between open tabs.
Drive has its own independent preference. If browser storage is disabled, the
switch still works for the current page, but the choice cannot survive a reload.

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
