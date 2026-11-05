import { expect, test, type Page, type Route } from "@playwright/test";

const caps = {
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
const id = "11111111-1111-4111-8111-111111111111";
const portId = "22222222-2222-4222-8222-222222222222";
const guest = () => ({
  id,
  name: "ubuntu-one",
  domain: "mc.hosting.i3alumba.ru",
  node: "gamma",
  status: "running",
  cpu: 2,
  memory_gb: 4,
  ports: [
    {
      id: portId,
      protocol: "tcp",
      public_port: 3001,
      target_port: 22,
      status: "active",
      reachability: "unknown",
    },
  ],
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  error: null,
});
const free = {
  available: true,
  reason: "free",
  checks: {
    alpha: { status: "free", reason: "" },
    gamma: { status: "free", reason: "" },
    registry: { status: "free", reason: "" },
  },
};
const secret = "write-only-fixture-password";
type Handler = (route: Route, path: string) => Promise<boolean | void>;
async function setup(
  page: Page,
  handler?: Handler,
  origin = "http://127.0.0.1:4173",
  hostingGrant: unknown = true,
) {
  const scope = origin.startsWith("https:")
    ? { domain: ".i3alumba.ru", path: "/", secure: true }
    : { url: origin };
  await page.context().addCookies([
    { name: "access_token", value: "fixture-access", ...scope },
    { name: "refresh_token", value: "fixture-refresh", ...scope },
  ]);
  await page.route("https://auth.i3alumba.ru/api/**", async (route) => {
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "authorization,content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    return route.fulfill({
      headers,
      json: {
        services: {
          hosting: {
            enabled: hostingGrant,
            url: "https://hosting.i3alumba.ru",
          },
        },
      },
    });
  });
  await page.route("**/api/containers/**", async (route) => {
    expect(new URL(route.request().url()).origin).toBe(origin);
    expect(["Bearer fixture-access", "Bearer refreshed-access"]).toContain(
      route.request().headers().authorization,
    );
    const path = new URL(route.request().url()).pathname.replace(
      "/api/containers/",
      "",
    );
    if (handler && (await handler(route, path))) return;
    if (path === "capabilities") return route.fulfill({ json: caps });
    if (path === "ports/check") return route.fulfill({ json: free });
    if (path === "" && route.request().method() === "GET")
      return route.fulfill({ json: { instances: [guest()] } });
    if (path.endsWith("/password"))
      return route.fulfill({ json: { changed: true } });
    return route.fulfill({ json: guest() });
  });
}
async function draft(page: Page) {
  await page.getByLabel("Name", { exact: true }).fill("new-ubuntu");
  await page.getByLabel("Initial root password").fill(secret);
  await page
    .getByRole("button", { name: "Create container", exact: true })
    .waitFor();
}

test("hosting entry is a normal service grid tile and backend still protects inventory", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  const tile = page.getByRole("link", { name: "Ubuntu Hosting", exact: true });
  await expect(tile).toHaveAttribute("href", "https://hosting.i3alumba.ru");
  await expect(tile.locator("..")).toHaveCSS("display", "grid");
  await expect(tile).toHaveCSS("min-height", "150px");
  await page.goto("/containers");
  await expect(
    page.getByRole("article", { name: "Container ubuntu-one" }),
  ).toBeVisible();
  await expect(
    page.getByText("ssh root@mc.hosting.i3alumba.ru -p 3001", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Allocation: published. Service: unknown."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);
});
for (const flag of [false, "true", 1, null]) {
  test(`malformed/nonadmin capability ${JSON.stringify(flag)} denies inventory independently of the portal card`, async ({
    page,
  }) => {
    let lists = 0;
    await setup(page, async (route, path) => {
      if (path === "capabilities") {
        await route.fulfill({ json: { ...caps, administrator: flag } });
        return true;
      }
      if (path === "") lists++;
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Your Services" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Ubuntu Hosting", exact: true }),
    ).toBeVisible();
    await page.goto("/containers");
    await expect(page.getByRole("alert")).toContainText(
      "Administrator access unavailable",
    );
    await expect(page.getByLabel("Initial root password")).toHaveCount(0);
    expect(lists).toBe(0);
  });
}
for (const status of [403, 404, 503]) {
  test(`capabilities ${status} fail closed on the direct route without changing portal grants`, async ({
    page,
  }) => {
    await setup(page, async (route, path) => {
      if (path === "capabilities") {
        await route.fulfill({ status, json: { detail: "Not permitted" } });
        return true;
      }
      if (path === "") throw new Error("Inventory must not be fetched");
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Your Services" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Ubuntu Hosting", exact: true }),
    ).toBeVisible();
    await page.goto("/containers");
    await expect(page.getByRole("alert")).toContainText(
      "Administrator access unavailable",
    );
    await expect(page.getByRole("article")).toHaveCount(0);
  });
}

test("create enforces limits, clear write-only password immediately, editable SSH and optional ports", async ({
  page,
}) => {
  let payload: Record<string, unknown> | undefined;
  await setup(page, async (route, path) => {
    if (path === "" && route.request().method() === "POST") {
      payload = route.request().postDataJSON();
      await route.fulfill({ json: guest() });
      return true;
    }
  });
  await page.goto("/containers");
  await draft(page);
  const create = page.getByRole("button", {
    name: "Create container",
    exact: true,
  });
  await page.getByLabel("CPU cores").fill("5");
  await expect(create).toBeDisabled();
  await page.getByLabel("CPU cores").fill("4");
  await page.getByLabel("Memory (GB decimal)").fill("16.1");
  await expect(create).toBeDisabled();
  await page.getByLabel("Memory (GB decimal)").fill("16");
  await page.getByLabel("Public port", { exact: true }).first().fill("3002");
  await page.getByRole("button", { name: "Add optional port" }).click();
  await page.getByLabel("Public port", { exact: true }).nth(1).fill("8080");
  await page.getByLabel("Guest target port").nth(1).fill("80");
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByLabel("Initial root password")).toHaveValue("");
  expect(payload).toEqual({
    name: "new-ubuntu",
    domain: "mc.hosting.i3alumba.ru",
    cpu: 4,
    memory_gb: 16,
    root_password: secret,
    ports: [
      { protocol: "tcp", public_port: 3002, target_port: 22 },
      { protocol: "tcp", public_port: 8080, target_port: 80 },
    ],
  });
  await expect(page.getByText(/No disk quota/)).toBeVisible();
  await expect(
    page.getByText(/Forwarded public range: 3000–50000/),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(secret);
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        cookies: document.cookie,
        url: location.href,
      }),
    ),
  ).not.toContain(secret);
});

test("SSH suggestion uses the forwarded range and validates public versus guest port bounds", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/containers");
  await draft(page);
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Create container", exact: true }),
  });
  const publicPort = form.getByLabel("Public port", { exact: true }).first();
  await expect(publicPort).toHaveValue("3001");
  await expect(
    form.getByText(/Forwarded public range: 3000–50000/),
  ).toBeVisible();
  await publicPort.fill("2999");
  await expect(
    form.getByRole("button", { name: "Create container", exact: true }),
  ).toBeDisabled();
  await expect(
    form.getByRole("button", { name: "Check availability" }).first(),
  ).toBeDisabled();
  for (const port of ["5432", "8000"]) {
    await publicPort.fill(port);
    await expect(
      form.getByRole("button", { name: "Create container", exact: true }),
    ).toBeEnabled();
    await expect(form.getByLabel("Guest target port").first()).toHaveValue(
      "22",
    );
  }
});

test("unconfigured external ingress blocks new public ports while preserving inventory and removal", async ({
  page,
}) => {
  await setup(page, async (route, path) => {
    if (path === "capabilities") {
      await route.fulfill({ json: { ...caps, external_ingress_ready: false } });
      return true;
    }
  });
  await page.goto("/containers");
  await draft(page);
  await expect(
    page.getByText(/External router\/ingress is not configured/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create container", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save additional port" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Remove port 3001/tcp" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("article", { name: "Container ubuntu-one" }),
  ).toBeVisible();
});

test("subdomain selection stays one label below hosting and preserves explicit public ports", async ({
  page,
}) => {
  let payload: Record<string, unknown> | undefined;
  await setup(page, async (route, path) => {
    if (path === "" && route.request().method() === "POST") {
      payload = route.request().postDataJSON();
      await route.fulfill({ json: guest() });
      return true;
    }
  });
  await page.goto("/containers");
  await draft(page);
  const subdomain = page.getByLabel("Subdomain", { exact: true });
  const create = page.getByRole("button", {
    name: "Create container",
    exact: true,
  });
  await expect(subdomain).toHaveValue("mc");
  for (const invalid of [
    "",
    "other.domain",
    "-bad",
    "bad-",
    "https://evil",
    "UPPER",
  ]) {
    await subdomain.fill(invalid);
    await expect(create).toBeDisabled();
  }
  await subdomain.fill("build-2");
  await expect(
    page.getByText(/Address: build-2.hosting.i3alumba.ru/),
  ).toBeVisible();
  await expect(create).toBeEnabled();
  await page.getByLabel("Public port", { exact: true }).first().fill("50001");
  await expect(create).toBeDisabled();
  await page.getByLabel("Public port", { exact: true }).first().fill("50000");
  await expect(create).toBeEnabled();
  await create.click();
  expect(payload?.domain).toBe("build-2.hosting.i3alumba.ru");
  expect(payload?.ports).toEqual([
    { protocol: "tcp", public_port: 50000, target_port: 22 },
  ]);
});

test("password upper bound and colon are rejected locally to match the server", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/containers");
  await draft(page);
  const create = page.getByRole("button", {
    name: "Create container",
    exact: true,
  });
  for (const value of ["x".repeat(257), secret + ":"]) {
    await page.getByLabel("Initial root password").fill(value);
    await expect(create).toBeDisabled();
  }
  await page.getByLabel("Initial root password").fill(secret);
  await expect(create).toBeEnabled();
});

test("password minimum and NUL validation; reset is masked and cleared on failure without reflection", async ({
  page,
}) => {
  await setup(page, async (route, path) => {
    if (path.endsWith("/password")) {
      await route.fulfill({
        status: 422,
        json: { detail: [{ input: secret, msg: secret }] },
      });
      return true;
    }
  });
  await page.goto("/containers");
  const field = page.getByLabel("New root password");
  await field.fill("short");
  await expect(
    page.getByRole("button", { name: "Reset root password" }),
  ).toBeDisabled();
  await field.fill(secret + "\0");
  await expect(
    page.getByRole("button", { name: "Reset root password" }),
  ).toBeDisabled();
  await field.fill(secret);
  await expect(field).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Reset root password" }).click();
  await expect(field).toHaveValue("");
  await expect(
    page.getByRole("alert").filter({ hasText: "server rejected" }),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(secret);
});

test("port checks distinguish free, conflict, unknown, and failed host inspection", async ({
  page,
}) => {
  let mode = 0;
  await setup(page, async (route, path) => {
    if (path === "ports/check") {
      const body =
        mode === 0
          ? free
          : mode === 1
            ? {
                ...free,
                available: false,
                checks: {
                  ...free.checks,
                  alpha: { status: "conflict", reason: "busy" },
                },
              }
            : { ...free, checks: { alpha: { status: "unexpected" } } };
      await route.fulfill(
        mode === 3
          ? {
              status: 503,
              json: {
                detail: {
                  code: "inspection_unavailable",
                  message: "Host unavailable",
                },
              },
            }
          : { json: body },
      );
      return true;
    }
  });
  await page.goto("/containers");
  const check = page
    .getByRole("button", { name: "Check availability" })
    .first();
  await check.click();
  await expect(
    page.getByText("Free now (advisory, not reserved)"),
  ).toBeVisible();
  mode = 1;
  await check.click();
  await expect(page.getByText("Port conflict: not available")).toBeVisible();
  mode = 2;
  await check.click();
  await expect(
    page.getByText("Inspection unknown: do not assume free"),
  ).toBeVisible();
  mode = 3;
  await check.click();
  await expect(
    page.getByText(/Service or host inspection unavailable/),
  ).toBeVisible();
  await expect(page.getByText("Free now (advisory, not reserved)")).toHaveCount(
    0,
  );
});

test("add/remove ports preserves guest ID/state and power controls never delete guest", async ({
  page,
}) => {
  const paths: string[] = [];
  let instance = guest();
  await setup(page, async (route, path) => {
    if (path === "" && route.request().method() === "GET") {
      await route.fulfill({ json: { instances: [instance] } });
      return true;
    }
    if (path.startsWith(id)) {
      paths.push(`${route.request().method()} ${path}`);
      if (path.endsWith("/stop")) instance = { ...instance, status: "stopped" };
      if (path.endsWith("/start"))
        instance = { ...instance, status: "running" };
      await route.fulfill({ json: instance });
      return true;
    }
  });
  await page.goto("/containers");
  const article = page.getByRole("article");
  await article.getByLabel("Public port", { exact: true }).fill("25565");
  await article.getByLabel("Guest target port").fill("25565");
  await article.getByRole("button", { name: "Check availability" }).click();
  await expect(
    article.getByText("Free now (advisory, not reserved)"),
  ).toBeVisible();
  await article.getByRole("button", { name: "Save additional port" }).click();
  await article.getByRole("button", { name: "Remove port 3001/tcp" }).click();
  await article.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(article.getByText(/State: stopped/)).toBeVisible();
  await article.getByRole("button", { name: "Start", exact: true }).click();
  await expect(article.getByText(/State: running/)).toBeVisible();
  expect(paths).toEqual([
    `POST ${id}/ports`,
    `DELETE ${id}/ports/${portId}`,
    `POST ${id}/stop`,
    `POST ${id}/start`,
  ]);
  await expect(article.getByText(`ID: ${id}`, { exact: true })).toBeVisible();
});

test("409 conflict and FastAPI strings are safe; retry succeeds and password not reflected", async ({
  page,
}) => {
  let attempts = 0;
  await setup(page, async (route, path) => {
    if (path === "" && route.request().method() === "POST") {
      attempts++;
      await route.fulfill(
        attempts === 1
          ? {
              status: 409,
              json: { detail: { code: "port_conflict", message: secret } },
            }
          : { json: guest() },
      );
      return true;
    }
  });
  await page.goto("/containers");
  await draft(page);
  await page
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  await expect(page.getByText(/Port or resource conflict/)).toBeVisible();
  await expect(page.getByLabel("Initial root password")).toHaveValue("");
  expect(await page.locator("body").innerText()).not.toContain(secret);
  await page.getByLabel("Initial root password").fill(secret);
  await page
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  expect(attempts).toBe(2);
});

test("pending mutations disable concurrent buttons; live 403 cancels late responses and clears forms", async ({
  page,
}) => {
  let revoked = false;
  let release: (() => void) | undefined;
  let started = false;
  await setup(page, async (route, path) => {
    if (path === "capabilities" && revoked) {
      await route.fulfill({ status: 403, json: { detail: "Forbidden" } });
      return true;
    }
    if (path === "" && route.request().method() === "POST") {
      started = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ json: guest() }).catch(() => {});
      return true;
    }
  });
  await page.goto("/containers");
  await draft(page);
  await page
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  await expect.poll(() => started).toBe(true);
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Reset root password" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Initial root password")).toHaveValue("");
  revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  release?.();
  await expect(page.getByRole("alert")).toContainText(
    "Administrator access unavailable",
  );
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("mutation 403 clears existing inventory, password and create draft", async ({
  page,
}) => {
  await setup(page, async (route, path) => {
    if (path.endsWith("/stop")) {
      await route.fulfill({ status: 403, json: { detail: "Forbidden" } });
      return true;
    }
  });
  await page.goto("/containers");
  await draft(page);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Administrator access revoked",
  );
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByLabel("Initial root password")).toHaveCount(0);
});

test("logout token loss clears panel and ignores pending data", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/containers");
  await draft(page);
  await page.context().clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByLabel("Initial root password")).toHaveCount(0);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`mobile 360 ${colorScheme} reduced motion has no horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await setup(page);
    await page.goto("/containers");
    await expect(page.getByRole("article")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("container 401 uses the existing Auth refresh and rotated JWT source", async ({
  page,
}) => {
  let attempts = 0;
  let refreshes = 0;
  await setup(page, async (route, path) => {
    if (path === "capabilities") {
      attempts++;
      if (route.request().headers().authorization === "Bearer fixture-access") {
        await route.fulfill({ status: 401, json: { detail: "Expired" } });
      } else {
        expect(route.request().headers().authorization).toBe(
          "Bearer refreshed-access",
        );
        await route.fulfill({ json: caps });
      }
      return true;
    }
  });
  await page.route(
    "https://auth.i3alumba.ru/api/token/refresh/",
    async (route) => {
      const headers = {
        "access-control-allow-origin": "http://127.0.0.1:4173",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST,OPTIONS",
      };
      if (route.request().method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      refreshes++;
      expect(route.request().postDataJSON()).toEqual({
        refresh: "fixture-refresh",
      });
      await route.fulfill({
        headers,
        json: { access: "refreshed-access", refresh: "refreshed-refresh" },
      });
    },
  );
  await page.goto("/containers");
  await expect(page.getByRole("article")).toBeVisible();
  expect(attempts).toBe(2);
  expect(refreshes).toBe(1);
  expect(
    (await page.context().cookies()).find(
      (cookie) => cookie.name === "refresh_token",
    )?.value,
  ).toBe("refreshed-refresh");
});

test("malformed inventory never renders a partial list or retains a password draft", async ({
  page,
}) => {
  let malformed = false;
  await setup(page, async (route, path) => {
    if (path === "" && route.request().method() === "GET" && malformed) {
      await route.fulfill({
        json: {
          instances: [guest(), { ...guest(), id: "not-a-uuid", name: secret }],
        },
      });
      return true;
    }
  });
  await page.goto("/containers");
  await draft(page);
  malformed = true;
  await page
    .getByRole("button", { name: "Retry / refresh access and inventory" })
    .click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByLabel("Initial root password")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(secret);
  malformed = false;
  await page
    .getByRole("button", { name: "Retry / refresh access and inventory" })
    .click();
  await expect(page.getByRole("article")).toBeVisible();
  await expect(page.getByLabel("Initial root password")).toHaveValue("");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
});

test("plain FastAPI error strings are not reflected and checks can retry", async ({
  page,
}) => {
  let attempts = 0;
  await setup(page, async (route, path) => {
    if (path === "ports/check") {
      attempts++;
      await route.fulfill(
        attempts === 1
          ? { status: 400, json: { detail: secret } }
          : { json: free },
      );
      return true;
    }
  });
  await page.goto("/containers");
  const check = page
    .getByRole("button", { name: "Check availability" })
    .first();
  await check.click();
  await expect(page.getByText(/The server rejected the request/)).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(secret);
  await check.click();
  await expect(
    page.getByText("Free now (advisory, not reserved)"),
  ).toBeVisible();
});

test("late pre-mutation inventory cannot overwrite a newer power state", async ({
  page,
}) => {
  let reads = 0;
  let release: (() => void) | undefined;
  let state = "running";
  await setup(page, async (route, path) => {
    if (path === "" && route.request().method() === "GET") {
      reads++;
      const status = state;
      if (reads === 2)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      await route.fulfill({ json: { instances: [{ ...guest(), status }] } });
      return true;
    }
    if (path.endsWith("/stop")) {
      state = "stopped";
      await route.fulfill({ json: { ...guest(), status: state } });
      return true;
    }
  });
  await page.goto("/containers");
  await expect(page.getByRole("article")).toBeVisible();
  await page
    .getByRole("button", { name: "Retry / refresh access and inventory" })
    .click();
  await expect.poll(() => reads).toBe(2);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText(/State: stopped/)).toBeVisible();
  release?.();
  await expect(page.getByText(/State: stopped/)).toBeVisible();
  expect(reads).toBe(3);
});

test("disabled creation explains invalid name and password without reflecting the secret", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/containers");
  await page.getByLabel("Name", { exact: true }).fill("Invalid Name");
  await page.getByLabel("Initial root password").fill("short");
  const status = page.getByRole("status", { name: "Create form validation" });
  await expect(status).toContainText("Name must start with a lowercase letter");
  await expect(status).toContainText("Root password must contain 16–256");
  await expect(
    page.getByRole("button", { name: "Create container", exact: true }),
  ).toBeDisabled();
  await expect(status).not.toContainText("short");
});

test("submission rechecks a silently changed DOM password despite a stale valid flag", async ({
  page,
}) => {
  let creates = 0;
  await setup(page, async (route, path) => {
    if (path === "" && route.request().method() === "POST") creates++;
  });
  await page.goto("/containers");
  await draft(page);
  await expect(
    page.getByRole("button", { name: "Create container", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Initial root password").evaluate((input) => {
    (input as HTMLInputElement).value = "short";
    input
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(
    page.getByRole("button", { name: "Create container", exact: true }),
  ).toBeDisabled();
  expect(creates).toBe(0);
  await expect(
    page.getByRole("status", { name: "Create form validation" }),
  ).toContainText("Root password must contain 16–256");
});

test("password-manager input enables a valid creation draft without storing the password", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/containers");
  await page.getByLabel("Name", { exact: true }).fill("new-ubuntu");
  await page.getByLabel("Initial root password").evaluate((input, value) => {
    const element = input as HTMLInputElement;
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, secret);
  await expect(
    page.getByRole("button", { name: "Create container", exact: true }),
  ).toBeEnabled();
  await expect(
    page.locator("label").filter({ hasText: "Initial root password" }),
  ).toHaveAttribute("data-shrink", "true");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(secret);
});

const gpu = { id: "0000:01:00.0", name: "Shared accelerator" };
const resourceCaps = {
  ...caps,
  max_cpu: null,
  max_memory_gb: null,
  aggregate_budget: { cpu: null, memory_gb: null },
  resources_editing_enabled: true,
  gpu_shared: true,
  gpus: [gpu],
};
const resourceGuest = () => ({
  ...guest(),
  resource_version: 7,
  gpu_ids: [] as string[],
});

test("null resource ceilings allow >4 CPU, >16GB fractional RAM and shared GPU creation", async ({
  page,
}) => {
  let payload: Record<string, unknown> | undefined;
  await setup(page, async (route, path) => {
    if (path === "capabilities") {
      await route.fulfill({ json: resourceCaps });
      return true;
    }
    if (path === "" && route.request().method() === "POST") {
      payload = route.request().postDataJSON();
      await route.fulfill({
        json: { ...resourceGuest(), cpu: 12, memory_gb: 32.125 },
      });
      return true;
    }
  });
  await page.goto("/containers");
  await draft(page);
  await page.getByLabel("CPU cores").fill("12");
  const memory = page.getByLabel("Memory (GB decimal)");
  const create = page.getByRole("button", {
    name: "Create container",
    exact: true,
  });
  await memory.fill("32.1234");
  await expect(create).toBeDisabled();
  await memory.fill("32.125");
  await page.getByRole("checkbox", { name: /Shared accelerator/ }).check();
  await create.click();
  expect(payload).toMatchObject({
    cpu: 12,
    memory_gb: 32.125,
    gpu_ids: [gpu.id],
  });
  await expect(page.getByLabel("Initial root password")).toHaveValue("");
});

for (const mode of ["increase", "decrease", "gpu", "remove"] as const) {
  test(`resource editor ${mode} uses opening revision and explicit restart consent`, async ({
    page,
  }) => {
    let payload: Record<string, unknown> | undefined;
    let revision = 7;
    const initial = {
      ...resourceGuest(),
      gpu_ids: mode === "remove" ? [gpu.id] : [],
    };
    await setup(page, async (route, path) => {
      if (path === "capabilities") {
        await route.fulfill({ json: resourceCaps });
        return true;
      }
      if (path === "" && route.request().method() === "GET") {
        await route.fulfill({
          json: { instances: [{ ...initial, resource_version: revision }] },
        });
        return true;
      }
      if (path.endsWith("/resources")) {
        payload = route.request().postDataJSON();
        await route.fulfill({ json: { ...initial, resource_version: 9 } });
        return true;
      }
    });
    await page.goto("/containers");
    await page.getByRole("button", { name: "Edit resources" }).click();
    const dialog = page.getByRole("dialog");
    revision = 8;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await dialog.getByLabel("CPU cores").fill("8");
    if (mode === "increase")
      await dialog.getByLabel("Memory (GB decimal)").fill("24.001");
    if (mode === "decrease")
      await dialog.getByLabel("Memory (GB decimal)").fill("2.5");
    if (mode === "gpu")
      await dialog
        .getByRole("checkbox", { name: /Shared accelerator/ })
        .check();
    if (mode === "remove")
      await dialog
        .getByRole("checkbox", { name: /Shared accelerator/ })
        .uncheck();
    const save = dialog.getByRole("button", { name: "Save resources" });
    if (mode !== "increase") {
      await expect(save).toBeDisabled();
      await expect(dialog.getByText(/Connections close; data/)).toBeVisible();
      await dialog
        .getByRole("checkbox", { name: /explicitly consent/ })
        .check();
    }
    await save.click();
    await expect(dialog).toHaveCount(0);
    expect(payload).toMatchObject({
      cpu: 8,
      expected_version: 7,
      allow_restart: mode !== "increase",
      gpu_ids: mode === "gpu" ? [gpu.id] : [],
    });
  });
}

test("resource conflict cannot blindly retry and authority loss closes the draft", async ({
  page,
}) => {
  let revoked = false;
  await setup(page, async (route, path) => {
    if (path === "capabilities") {
      await route.fulfill(
        revoked ? { status: 403, json: {} } : { json: resourceCaps },
      );
      return true;
    }
    if (path === "" && route.request().method() === "GET") {
      await route.fulfill({ json: { instances: [resourceGuest()] } });
      return true;
    }
    if (path.endsWith("/resources")) {
      await route.fulfill({ status: 409, json: { detail: secret } });
      return true;
    }
  });
  await page.goto("/containers");
  await page.getByRole("button", { name: "Edit resources" }).click();
  await page.getByRole("button", { name: "Save resources" }).click();
  await expect(
    page.getByRole("dialog").getByText(/Update not confirmed/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save resources" }),
  ).toBeDisabled();
  expect(await page.locator("body").innerText()).not.toContain(secret);
  revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("legacy capabilities preserve creation but disable resource editing and GPUs", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/containers");
  await draft(page);
  await expect(
    page.getByRole("button", { name: "Edit resources" }),
  ).toBeDisabled();
  await expect(page.getByText(/Ask the operator to upgrade/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create container", exact: true }),
  ).toBeEnabled();
});

for (const status of ["creating", "error", "stopped", "running"]) {
  test(`resource editing fails closed with missing revision in ${status}`, async ({
    page,
  }) => {
    await setup(page, async (route, path) => {
      if (path === "capabilities") {
        await route.fulfill({ json: resourceCaps });
        return true;
      }
      if (path === "" && route.request().method() === "GET") {
        await route.fulfill({
          json: { instances: [{ ...guest(), gpu_ids: [], status }] },
        });
        return true;
      }
    });
    await page.goto("/containers");
    await expect(
      page.getByRole("button", { name: "Edit resources" }),
    ).toBeDisabled();
  });
}

test("unavailable selected GPU requires explicit removal", async ({ page }) => {
  await setup(page, async (route, path) => {
    if (path === "capabilities") {
      await route.fulfill({ json: resourceCaps });
      return true;
    }
    if (path === "" && route.request().method() === "GET") {
      await route.fulfill({
        json: {
          instances: [
            {
              ...resourceGuest(),
              status: "stopped",
              gpu_ids: ["0000:02:00.0"],
            },
          ],
        },
      });
      return true;
    }
  });
  await page.goto("/containers");
  await page.getByRole("button", { name: "Edit resources" }).click();
  await expect(
    page.getByRole("button", { name: "Save resources" }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /Unavailable GPU/ }).click();
  await expect(
    page.getByRole("button", { name: "Save resources" }),
  ).toBeEnabled();
});

for (const value of ["true", "null", "1e309", "0.0001"]) {
  test(`malformed RAM ${value} never renders inventory`, async ({ page }) => {
    await setup(page, async (route, path) => {
      if (path === "" && route.request().method() === "GET") {
        const body = JSON.stringify({ instances: [resourceGuest()] }).replace(
          '"memory_gb":4',
          `"memory_gb":${value}`,
        );
        await route.fulfill({ contentType: "application/json", body });
        return true;
      }
    });
    await page.goto("/containers");
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(
      page.getByText(/Administrator access unavailable/),
    ).toBeVisible();
  });
}

for (const state of ["creating", "error"]) {
  test(`resource revision does not enable editing in ${state}`, async ({
    page,
  }) => {
    await setup(page, async (route, path) => {
      if (path === "capabilities") {
        await route.fulfill({ json: resourceCaps });
        return true;
      }
      if (path === "" && route.request().method() === "GET") {
        await route.fulfill({
          json: { instances: [{ ...resourceGuest(), status: state }] },
        });
        return true;
      }
    });
    await page.goto("/containers");
    await expect(
      page.getByRole("button", { name: "Edit resources" }),
    ).toBeDisabled();
  });
}

for (const revision of [-1, 1.5, 9007199254740992, true]) {
  test(`unsafe resource revision ${revision} fails closed`, async ({
    page,
  }) => {
    await setup(page, async (route, path) => {
      if (path === "capabilities") {
        await route.fulfill({ json: resourceCaps });
        return true;
      }
      if (path === "" && route.request().method() === "GET") {
        await route.fulfill({
          json: {
            instances: [{ ...resourceGuest(), resource_version: revision }],
          },
        });
        return true;
      }
    });
    await page.goto("/containers");
    await expect(
      page.getByRole("button", { name: "Edit resources" }),
    ).toBeDisabled();
  });
}

test("resource mutation is single-flight and late success cannot restore revoked inventory", async ({
  page,
}) => {
  let revoked = false;
  let release: (() => void) | undefined;
  let calls = 0;
  await setup(page, async (route, path) => {
    if (path === "capabilities") {
      await route.fulfill(
        revoked ? { status: 403, json: {} } : { json: resourceCaps },
      );
      return true;
    }
    if (path === "" && route.request().method() === "GET") {
      await route.fulfill({ json: { instances: [resourceGuest()] } });
      return true;
    }
    if (path.endsWith("/resources")) {
      calls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ json: resourceGuest() }).catch(() => {});
      return true;
    }
  });
  await page.goto("/containers");
  await page.getByRole("button", { name: "Edit resources" }).click();
  await page.getByRole("button", { name: "Save resources" }).click();
  await expect.poll(() => calls).toBe(1);
  await expect(
    page.getByRole("button", { name: "Save resources" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  release?.();
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(calls).toBe(1);
});

test("malformed GPU capability cannot enable GPU or existing resource writes", async ({
  page,
}) => {
  await setup(page, async (route, path) => {
    if (path === "capabilities") {
      await route.fulfill({
        json: {
          ...resourceCaps,
          gpus: [{ id: "/dev/arbitrary", name: "Not allowed" }],
        },
      });
      return true;
    }
    if (path === "" && route.request().method() === "GET") {
      await route.fulfill({ json: { instances: [resourceGuest()] } });
      return true;
    }
  });
  await page.goto("/containers");
  await draft(page);
  await expect(
    page.getByRole("button", { name: "Edit resources" }),
  ).toBeDisabled();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create container", exact: true }),
  ).toBeEnabled();
});

async function confirmRestart(page: Page) {
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Restart ubuntu-one?" });
  await expect(dialog).toContainText("Existing connections will close");
  await dialog.getByRole("button", { name: "Restart", exact: true }).click();
}

test("restart confirms intent and uses only existing stop then start endpoints", async ({
  page,
}) => {
  const calls: string[] = [];
  await setup(page, async (route, path) => {
    if (path === `${id}/stop` || path === `${id}/start`) {
      expect(route.request().method()).toBe("POST");
      calls.push(path);
      if (path.endsWith("/start"))
        expect(calls).toEqual([`${id}/stop`, `${id}/start`]);
      await route.fulfill({
        json: {
          ...guest(),
          status: path.endsWith("/stop") ? "stopped" : "running",
        },
      });
      return true;
    }
    if (path.includes("restart"))
      throw new Error("No backend restart endpoint exists");
  });
  await page.goto("/containers");
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  const closingConfirm = await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restart", exact: true })
    .elementHandle();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  // A cancelled dialog must not retain an actionable confirmation during exit.
  await closingConfirm!.evaluate((button) =>
    (button as HTMLButtonElement).click(),
  );
  await closingConfirm!.dispose();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls).toEqual([]);
  await confirmRestart(page);
  await expect.poll(() => calls).toEqual([`${id}/stop`, `${id}/start`]);
  await expect(
    page.getByRole("button", { name: "Restart", exact: true }),
  ).toBeEnabled();
});

test("restart holds one mutation reservation through both power requests", async ({
  page,
}) => {
  const calls: string[] = [];
  let stopDone: (() => void) | undefined;
  let startDone: (() => void) | undefined;
  await setup(page, async (route, path) => {
    if (path === `${id}/stop` || path === `${id}/start`) {
      calls.push(path);
      await new Promise<void>((resolve) => {
        if (path.endsWith("/stop")) stopDone = resolve;
        else startDone = resolve;
      });
      await route.fulfill({
        json: {
          ...guest(),
          status: path.endsWith("/stop") ? "stopped" : "running",
        },
      });
      return true;
    }
  });
  await page.goto("/containers");
  await confirmRestart(page);
  await expect.poll(() => calls.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Restart", exact: true }),
  ).toBeDisabled();
  stopDone?.();
  await expect.poll(() => calls.length).toBe(2);
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Restart", exact: true }),
  ).toBeDisabled();
  startDone?.();
  await expect(
    page.getByRole("button", { name: "Restart", exact: true }),
  ).toBeEnabled();
  expect(calls).toEqual([`${id}/stop`, `${id}/start`]);
});

for (const failure of [
  "network",
  "503",
  "403",
  "wrong-state",
  "wrong-id",
] as const) {
  test(`restart never starts after ${failure} stop response`, async ({
    page,
  }) => {
    const calls: string[] = [];
    await setup(page, async (route, path) => {
      if (path === `${id}/stop`) {
        calls.push(path);
        if (failure === "network") await route.abort();
        else if (failure === "503" || failure === "403")
          await route.fulfill({
            status: Number(failure),
            json: { detail: "Unconfirmed" },
          });
        else
          await route.fulfill({
            json: {
              ...guest(),
              status: failure === "wrong-state" ? "running" : "stopped",
              id: failure === "wrong-id" ? portId : id,
            },
          });
        return true;
      }
      if (path === `${id}/start`) {
        calls.push(path);
        return true;
      }
    });
    await page.goto("/containers");
    await confirmRestart(page);
    await expect(
      page.getByRole("alert").filter({
        hasText:
          failure === "403"
            ? "Administrator access revoked"
            : failure.startsWith("wrong")
              ? "Invalid server response"
              : "stop outcome is unconfirmed",
      }),
    ).toBeVisible();
    expect(calls).toEqual([`${id}/stop`]);
  });
}

test("failed start is reported as unconfirmed without replaying restart", async ({
  page,
}) => {
  const calls: string[] = [];
  await setup(page, async (route, path) => {
    if (path === `${id}/stop`) {
      calls.push(path);
      await route.fulfill({ json: { ...guest(), status: "stopped" } });
      return true;
    }
    if (path === `${id}/start`) {
      calls.push(path);
      await route.fulfill({ status: 503, json: { detail: "Unknown" } });
      return true;
    }
  });
  await page.goto("/containers");
  await confirmRestart(page);
  await expect(
    page.getByRole("alert").filter({
      hasText: "Container was stopped, but restart completion is unconfirmed",
    }),
  ).toBeVisible();
  expect(calls).toEqual([`${id}/stop`, `${id}/start`]);
});

test("authority loss during stop fences the late reply and prevents start", async ({
  page,
}) => {
  let revoked = false;
  let release: (() => void) | undefined;
  const calls: string[] = [];
  await setup(page, async (route, path) => {
    if (path === "capabilities" && revoked) {
      await route.fulfill({ status: 403 });
      return true;
    }
    if (path === `${id}/stop`) {
      calls.push(path);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route
        .fulfill({ json: { ...guest(), status: "stopped" } })
        .catch(() => {});
      return true;
    }
    if (path === `${id}/start`) {
      calls.push(path);
      return true;
    }
  });
  await page.goto("/containers");
  await confirmRestart(page);
  await expect.poll(() => calls.length).toBe(1);
  revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("article")).toHaveCount(0);
  release?.();
  expect(calls).toEqual([`${id}/stop`]);
});

test("changed browser session after stop does not start automatically", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const calls: string[] = [];
  await setup(page, async (route, path) => {
    if (path === `${id}/stop`) {
      calls.push(path);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ json: { ...guest(), status: "stopped" } });
      return true;
    }
    if (path === `${id}/start`) {
      calls.push(path);
      return true;
    }
  });
  await page.goto("/containers");
  await confirmRestart(page);
  await expect.poll(() => calls.length).toBe(1);
  await page.context().addCookies([
    {
      name: "access_token",
      value: "refreshed-access",
      url: "http://127.0.0.1:4173",
    },
  ]);
  release?.();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Session changed after stopping" }),
  ).toBeVisible();
  expect(calls).toEqual([`${id}/stop`]);
});

test("restart confirmation cannot act after the container stops during polling", async ({
  page,
}) => {
  let stopped = false;
  const calls: string[] = [];
  await setup(page, async (route, path) => {
    if (path === "" && route.request().method() === "GET") {
      await route.fulfill({
        json: {
          instances: [{ ...guest(), status: stopped ? "stopped" : "running" }],
        },
      });
      return true;
    }
    if (path.endsWith("/stop") || path.endsWith("/start")) {
      calls.push(path);
      return true;
    }
  });
  await page.goto("/containers");
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  stopped = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Restart", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(calls).toEqual([]);
});

test("authority loss closes an unconfirmed restart without power requests", async ({
  page,
}) => {
  let revoked = false;
  const calls: string[] = [];
  await setup(page, async (route, path) => {
    if (path === "capabilities" && revoked) {
      await route.fulfill({ status: 403 });
      return true;
    }
    if (path.endsWith("/stop") || path.endsWith("/start")) {
      calls.push(path);
      return true;
    }
  });
  await page.goto("/containers");
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(calls).toEqual([]);
});

for (const status of ["stopped", "creating", "error"] as const) {
  test(`restart is disabled for ${status} containers`, async ({ page }) => {
    await setup(page, async (route, path) => {
      if (path === "" && route.request().method() === "GET") {
        await route.fulfill({ json: { instances: [{ ...guest(), status }] } });
        return true;
      }
    });
    await page.goto("/containers");
    await expect(
      page.getByRole("button", { name: "Restart", exact: true }),
    ).toBeDisabled();
  });
}
