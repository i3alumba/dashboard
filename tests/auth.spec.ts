import { expect, test } from "@playwright/test";

test("login establishes the central session with CSRF and only shows granted services", async ({
  page,
  context,
  baseURL,
}) => {
  let authenticated = false;
  let logins = 0;
  let legacyLogins = 0;
  const headers = {
    "access-control-allow-origin": baseURL!,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type,x-csrftoken,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };
  await context.route("https://auth.i3alumba.ru/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (path === "/api/session/")
      return route.fulfill({
        headers,
        json: { authenticated, csrfToken: "fixture-csrf" },
      });
    if (path === "/api/session/login/") {
      expect(req.headers()["x-csrftoken"]).toBe("fixture-csrf");
      expect(req.postDataJSON()).toEqual({
        username: "procsima",
        password: "fixture-password",
      });
      logins++;
      authenticated = true;
      return route.fulfill({
        headers,
        json: { access: "fixture-access", refresh: "fixture-refresh" },
      });
    }
    if (path === "/api/token/") legacyLogins++;
    if (path === "/api/access/")
      return route.fulfill({
        headers,
        json: {
          services: {
            gitlab: { enabled: true, url: "https://gitlab.i3alumba.ru" },
            drive: { enabled: false, url: "https://drive.i3alumba.ru" },
          },
        },
      });
    return route.fulfill({ status: 400, headers, json: {} });
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill("procsima");
  await page.getByLabel("Password").fill("fixture-password");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(
    page.getByRole("heading", { name: "Your Services" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "GitLab", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Drive", exact: true }),
  ).toHaveCount(0);
  expect(logins).toBe(1);
  expect(legacyLogins).toBe(0);
});

test("an existing Auth session opens Dashboard without another password and logout ends it", async ({
  page,
  context,
  baseURL,
}) => {
  let authenticated = true;
  let issued = 0;
  let logins = 0;
  const headers = {
    "access-control-allow-origin": baseURL!,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type,x-csrftoken,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };
  await context.route("https://auth.i3alumba.ru/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (path === "/api/session/")
      return route.fulfill({
        headers,
        json: { authenticated, csrfToken: "fixture-csrf" },
      });
    if (path === "/api/session/token/") {
      expect(req.headers()["x-csrftoken"]).toBe("fixture-csrf");
      issued++;
      return route.fulfill({
        headers,
        json: { access: "restored-access", refresh: "restored-refresh" },
      });
    }
    if (path === "/api/session/login/") logins++;
    if (path === "/api/session/logout/") {
      expect(req.headers()["x-csrftoken"]).toBe("fixture-csrf");
      expect(req.postDataJSON()).toEqual({ refresh: "restored-refresh" });
      authenticated = false;
      return route.fulfill({ headers, json: { authenticated: false } });
    }
    return route.fulfill({
      headers,
      json: {
        services: {
          drive: { enabled: true, url: "https://drive.i3alumba.ru" },
        },
      },
    });
  });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Your Services" }),
  ).toBeVisible();
  expect(issued).toBeGreaterThan(0);
  expect(logins).toBe(0);
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeEnabled();
  const names = (await context.cookies()).map((c) => c.name);
  expect(names).not.toContain("access_token");
  expect(names).not.toContain("refresh_token");
  expect(authenticated).toBe(false);
});

test("rotated refresh tokens are saved and concurrent expired requests share one refresh", async ({
  page,
  context,
  baseURL,
}) => {
  let access = "old-access",
    refresh = "old-refresh";
  let expired = true,
    refreshes = 0;
  await context.addCookies([
    { name: "access_token", value: access, url: baseURL! },
    { name: "refresh_token", value: refresh, url: baseURL! },
  ]);
  const headers = {
    "access-control-allow-origin": baseURL!,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type,x-csrftoken,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };
  await context.route("https://auth.i3alumba.ru/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (path === "/api/token/refresh/") {
      expect(req.postDataJSON()).toEqual({ refresh });
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      access = "fresh-access-" + refreshes;
      refresh = "fresh-refresh-" + refreshes;
      expired = false;
      return route.fulfill({ headers, json: { access, refresh } });
    }
    if (path === "/api/access/") {
      if (expired || req.headers().authorization !== "Bearer " + access)
        return route.fulfill({ status: 401, headers, json: {} });
      return route.fulfill({
        headers,
        json: {
          services: {
            drive: { enabled: true, url: "https://drive.i3alumba.ru" },
          },
        },
      });
    }
    return route.fulfill({ status: 400, headers, json: {} });
  });
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Drive", exact: true }),
  ).toBeVisible();
  expect(refreshes).toBe(1);
  expect(
    (await context.cookies()).find((c) => c.name === "refresh_token")?.value,
  ).toBe("fresh-refresh-1");
  expired = true;
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Drive", exact: true }),
  ).toBeVisible();
  expect(refreshes).toBe(2);
  expect(
    (await context.cookies()).find((c) => c.name === "refresh_token")?.value,
  ).toBe("fresh-refresh-2");
});
