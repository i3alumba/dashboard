import { expect, test, type Page } from "@playwright/test";

const portal = "https://main.i3alumba.ru";
const hosting = "https://hosting.i3alumba.ru";
const capabilities = {
  administrator: true,
  node: "gamma",
  max_cpu: 4,
  max_memory_gb: 16,
  domain_suffix: "hosting.i3alumba.ru",
  image: "Ubuntu 24.04 LTS",
  disk_quota: false,
  home_separate: true,
  root_persistence: "full",
  external_ingress_ready: true,
};

async function virtualOrigins(page: Page, grant: unknown = true) {
  // Only local Vite serves assets; no production services/DNS are contacted.
  await page.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    if (
      [
        portal,
        hosting,
        "https://auth.i3alumba.ru",
        "http://127.0.0.1:4173",
      ].includes(origin)
    )
      return route.fallback();
    return route.abort();
  });
  await page.routeWebSocket("**/*", (socket) => socket.close());
  await page.context().addCookies([
    {
      name: "access_token",
      value: "fixture-access",
      domain: ".i3alumba.ru",
      path: "/",
      secure: true,
    },
    {
      name: "refresh_token",
      value: "fixture-refresh",
      domain: ".i3alumba.ru",
      path: "/",
      secure: true,
    },
  ]);
  await page.route("https://auth.i3alumba.ru/api/**", (route) =>
    route.fulfill({
      json: {
        services: {
          drive: { enabled: true, url: "https://drive.i3alumba.ru" },
          matrix: { enabled: true, url: "https://matrix.i3alumba.ru" },
          gitlab: { enabled: true, url: "https://gitlab.i3alumba.ru" },
          minio: { enabled: true, url: "https://minio.i3alumba.ru" },
          jenkins: { enabled: true, url: "https://jenkins.i3alumba.ru" },
          monitor: { enabled: true, url: "https://monitor.i3alumba.ru" },
          hosting: { enabled: grant, url: hosting },
        },
      },
      headers: {
        "access-control-allow-origin": portal,
        "access-control-allow-headers": "authorization,content-type",
      },
    }),
  );
  for (const origin of [portal, hosting]) {
    await page.route(origin + "/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/containers/")) {
        expect(url.origin).toBe(hosting);
        expect(route.request().headers().authorization).toBe(
          "Bearer fixture-access",
        );
        if (url.pathname.endsWith("/capabilities"))
          return route.fulfill({ json: capabilities });
        return route.fulfill({ json: { instances: [] } });
      }
      const response = await route.fetch({
        url: "http://127.0.0.1:4173" + url.pathname + url.search,
      });
      return route.fulfill({ response });
    });
  }
}

test("main grid Hosting tile opens standalone root and same-origin Hosting API", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  await virtualOrigins(page);
  await page.goto(portal + "/");
  const tile = page.getByRole("link", { name: "Ubuntu Hosting", exact: true });
  await expect(tile).toHaveAttribute("href", hosting);
  await expect(tile.locator("..")).toHaveCSS("display", "grid");
  await expect(tile).toHaveCSS("min-height", "150px");
  await expect(tile.locator("..").locator(":scope > a")).toHaveCount(7);
  await page.screenshot({
    path: testInfo.outputPath("hosting-portal-grid.png"),
  });
  await tile.click();
  await expect(page).toHaveURL(hosting + "/");
  await expect(
    page.getByRole("heading", { name: "Create Ubuntu container", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ubuntu Hosting", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to Dashboard" }),
  ).toHaveAttribute("href", portal + "/");
  await page.screenshot({
    path: testInfo.outputPath("hosting-standalone-root.png"),
  });
});

for (const grant of [false, "true", 1, null]) {
  test(`main grid rejects inexact hosting grant ${JSON.stringify(grant)}`, async ({
    page,
  }) => {
    await virtualOrigins(page, grant);
    await page.goto(portal + "/");
    await expect(
      page.getByRole("link", { name: "Resource Monitor", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Ubuntu Hosting", exact: true }),
    ).toHaveCount(0);
  });
}

test("legacy portal path redirects to fixed Hosting root without query or credential forwarding", async ({
  page,
}) => {
  await virtualOrigins(page);
  await page.goto(portal + "/containers?token=synthetic-do-not-forward");
  await expect(page).toHaveURL(hosting + "/");
  await expect(
    page.getByRole("heading", { name: "Create Ubuntu container", exact: true }),
  ).toBeVisible();
});

test("Hosting restores the central host-only Auth session with CSRF before opening its own API", async ({
  page,
}) => {
  await virtualOrigins(page);
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: "__Host-auth-fixture",
      value: "fixture-session",
      url: "https://auth.i3alumba.ru/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  let bridges = 0;
  await page.route("https://auth.i3alumba.ru/api/**", async (route) => {
    const headers = {
      "access-control-allow-origin": hosting,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-csrftoken",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (route.request().url().endsWith("/session/token/")) {
      expect(route.request().headers()["x-csrftoken"]).toBe("fixture-csrf");
      expect(route.request().headers().cookie).toContain(
        "__Host-auth-fixture=fixture-session",
      );
      bridges++;
      return route.fulfill({
        headers,
        json: { access: "fixture-access", refresh: "fixture-refresh" },
      });
    }
    return route.fulfill({
      headers,
      json: { authenticated: true, csrfToken: "fixture-csrf" },
    });
  });
  await page.goto(hosting + "/");
  await expect(
    page.getByRole("heading", { name: "Create Ubuntu container", exact: true }),
  ).toBeVisible();
  // Vite development StrictMode may replay the mount effect; both requests
  // must carry the same valid CSRF/session proof, without any redirect token.
  expect(bridges).toBeGreaterThanOrEqual(1);
  expect(bridges).toBeLessThanOrEqual(2);
});

test("direct Hosting root denies a nonstaff backend response without loading inventory", async ({
  page,
}) => {
  await virtualOrigins(page, false);
  await page.route(hosting + "/api/containers/**", (route) => {
    expect(route.request().url()).toBe(
      hosting + "/api/containers/capabilities",
    );
    return route.fulfill({
      status: 403,
      json: { detail: { code: "administrator_required" } },
    });
  });
  await page.goto(hosting + "/");
  await expect(page.getByRole("alert")).toContainText(
    "Administrator access unavailable",
  );
  await expect(page.getByLabel("Initial root password")).toHaveCount(0);
});

test("Hosting legacy subpath canonicalizes to standalone root", async ({
  page,
}) => {
  await virtualOrigins(page);
  await page.goto(hosting + "/containers");
  await expect(page).toHaveURL(hosting + "/");
  await expect(
    page.getByRole("heading", { name: "Create Ubuntu container", exact: true }),
  ).toBeVisible();
});
