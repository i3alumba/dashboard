import { expect, test, type Page } from "@playwright/test";

async function expectTheme(page: Page, mode: "light" | "dark") {
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${mode}\\b`));
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    mode === "dark" ? "rgb(18, 18, 18)" : "rgb(255, 255, 255)",
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
      page.evaluate(() => localStorage.getItem("dashboard-color-mode")),
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
