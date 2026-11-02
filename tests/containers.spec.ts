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
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(secret);
});
