import { expect, test, type Page } from "@playwright/test";

async function expectTheme(page: Page, mode: "light" | "dark") {
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${mode}\\b`));
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    mode === "dark" ? "rgb(11, 18, 32)" : "rgb(244, 247, 251)",
  );
  await expect(
    page.getByRole("button", {
      name: `Switch to ${mode === "dark" ? "light" : "dark"} theme`,
    }),
  ).toBeEnabled();
}

test.beforeEach(async ({ context }) => {
  // No real authentication server or user credentials are used.
  await context.route("https://auth.i3alumba.ru/api/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/session/") {
      return route.fulfill({
        json: { authenticated: false, csrfToken: "fixture-csrf" },
      });
    }
    return route.fulfill({
      json: {
        services: {
          drive: { enabled: true, url: "https://drive.i3alumba.ru" },
        },
      },
    });
  });
});

for (const mode of ["light", "dark"] as const) {
  test(`initially follows the ${mode} system theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    await page.goto("/login");
    await expectTheme(page, mode);
  });
}

test("switches both ways, preserves form input and persists after reload", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("theme-test");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expectTheme(page, "dark");
  await expect(page.getByLabel("Username")).toHaveValue("theme-test");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("i3alumba-color-mode")),
    )
    .toBe("dark");
  await page.reload();
  await expectTheme(page, "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.reload();
  await expectTheme(page, "light");
});

test("follows system changes until an explicit choice overrides them", async ({
  page,
}) => {
  await page.goto("/login");
  await expectTheme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "light");
});

test("synchronizes the saved choice between tabs", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  const second = await context.newPage();
  await second.goto("/login");
  await expectTheme(second, "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expectTheme(second, "dark");
});

test("still switches when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });
  });
  await page.goto("/login");
  await expectTheme(page, "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expectTheme(page, "dark");
});

test("the authenticated dashboard also uses the theme", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "access_token", value: "test-access", url: baseURL! },
    { name: "refresh_token", value: "test-refresh", url: baseURL! },
  ]);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your Services" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expectTheme(page, "dark");
  await expect(
    page.getByRole("link", { name: "Drive", exact: true }),
  ).toBeVisible();
});

test("the toggle is visible and keyboard accessible on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/login");
  const button = page.getByRole("button", { name: "Switch to dark theme" });
  await expect(button).toBeVisible();
  const rect = await button.boundingBox();
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(320);
  await button.focus();
  await page.keyboard.press("Enter");
  await expectTheme(page, "dark");
});

test("shared cookie wins over shared and legacy storage", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "i3alumba-theme", value: "dark", url: baseURL! },
  ]);
  await page.addInitScript(() => {
    localStorage.setItem("i3alumba-color-mode", "light");
    localStorage.setItem("dashboard-color-mode", "light");
  });
  await page.goto("/login");
  await expectTheme(page, "dark");
});

test("legacy preference migrates once into shared storage and cookie", async ({
  page,
  context,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("dashboard-color-mode", "dark"),
  );
  await page.goto("/login");
  await expectTheme(page, "dark");
  expect(
    await page.evaluate(() => localStorage.getItem("i3alumba-color-mode")),
  ).toBe("dark");
  const cookie = (await context.cookies()).find(
    (c) => c.name === "i3alumba-theme",
  );
  expect(cookie?.value).toBe("dark");
  expect(cookie?.path).toBe("/");
  expect(cookie?.sameSite).toBe("Lax");
  await page.reload();
  await expectTheme(page, "dark");
});

test("invalid preferences are ignored", async ({ page, context, baseURL }) => {
  await context.addCookies([
    { name: "i3alumba-theme", value: "invalid", url: baseURL! },
  ]);
  await page.addInitScript(() => {
    localStorage.setItem("i3alumba-color-mode", "invalid");
    localStorage.setItem("dashboard-color-mode", "invalid");
  });
  await page.goto("/login");
  await expectTheme(page, "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expectTheme(page, "dark");
});

test("memory fallback works when both cookies and local storage are denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
    Object.defineProperty(document, "cookie", {
      get() {
        throw new DOMException("Denied", "SecurityError");
      },
      set() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
  });
  await page.goto("/login");
  await expectTheme(page, "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expectTheme(page, "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expectTheme(page, "light");
});

for (const mode of ["light", "dark"] as const) {
  test(`shared ${mode} surfaces, fields, buttons and mobile layout`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: mode });
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/login");
    await expectTheme(page, mode);
    await expect(page.locator("header")).toHaveCSS(
      "background-color",
      mode === "dark" ? "rgb(18, 30, 48)" : "rgb(255, 255, 255)",
    );
    await expect(page.locator("form").locator("..")).toHaveCSS(
      "background-color",
      mode === "dark" ? "rgb(18, 30, 48)" : "rgb(255, 255, 255)",
    );
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toHaveCSS(
      "text-transform",
      "none",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
  });
}

test("same-origin storage writer synchronizes a live page despite an older cookie", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  const second = await context.newPage();
  await second.goto("/login");
  await second.evaluate(() =>
    localStorage.setItem("i3alumba-color-mode", "light"),
  );
  await expectTheme(page, "light");
});

test("sibling domains share only the theme cookie and synchronize live and on reload", async ({
  page,
  context,
  baseURL,
}) => {
  // Serve all app resources locally: neither DNS nor production services are used.
  await context.route(
    /^https:\/\/(dashboard|drive)\.i3alumba\.ru\//,
    async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: baseURL! + url.pathname + url.search,
      });
      await route.fulfill({ response });
    },
  );
  await page.goto("https://dashboard.i3alumba.ru/login");
  const sibling = await context.newPage();
  await sibling.goto("https://drive.i3alumba.ru/login");
  await expectTheme(sibling, "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expectTheme(sibling, "dark");
  const cookie = (await context.cookies()).find(
    (c) => c.name === "i3alumba-theme",
  );
  expect(cookie).toMatchObject({
    domain: ".i3alumba.ru",
    path: "/",
    secure: true,
    sameSite: "Lax",
    value: "dark",
  });
  expect((await context.cookies()).map((c) => c.name)).toEqual([
    "i3alumba-theme",
  ]);
  await sibling.reload();
  await expectTheme(sibling, "dark");
  await sibling.getByRole("button", { name: "Switch to light theme" }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expectTheme(page, "light");
});
