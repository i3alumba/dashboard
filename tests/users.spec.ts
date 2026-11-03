import { expect, test, type Page } from "@playwright/test";
import type { NativeState, NativeManagement } from "../src/user-admin/types";

const portal = "https://main.i3alumba.ru";
const origin = "https://users.i3alumba.ru";
const services = [
  "drive",
  "matrix",
  "gitlab",
  "minio",
  "monitor",
  "hosting",
  "jenkins",
];
function member(id: number, username: string, admin = false) {
  return {
    id,
    username,
    email: `${username}@example.test`,
    first_name: "",
    last_name: "",
    is_admin: admin,
    is_active: true,
    version: 0,
    etag: '"' + "a".repeat(64) + '"',
    services: Object.fromEntries(
      services.map((slug) => [
        slug,
        {
          assigned: false,
          granted: admin && slug !== "jenkins",
          effective: admin && slug !== "jenkins",
          readonly: ["jenkins", "hosting"].includes(slug),
        },
      ]),
    ),
    native: {} as Record<string, NativeState>,
  };
}
async function fixture(page: Page, grant: unknown = true) {
  const state = {
    rows: [member(1, "operator", true), member(2, "member")],
    denied: false,
    failMutation: 0,
    capOverrides: {} as Record<string, unknown>,
    holdList: null as Promise<void> | null,
    onList: null as (() => void) | null,
    calls: [] as {
      method: string;
      path: string;
      body: Record<string, unknown>;
      etag?: string;
      key?: string;
    }[],
  };
  await page.route("**/*", (route) =>
    [
      portal,
      origin,
      "https://auth.i3alumba.ru",
      "http://127.0.0.1:4173",
    ].includes(new URL(route.request().url()).origin)
      ? route.fallback()
      : route.abort(),
  );
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
          users: { enabled: grant, url: origin },
          jenkins: { enabled: true, url: "https://jenkins.i3alumba.ru" },
        },
      },
      headers: {
        "access-control-allow-origin": portal,
        "access-control-allow-headers": "authorization,content-type",
      },
    }),
  );
  for (const host of [portal, origin])
    await page.route(host + "/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/user-admin/")) {
        const response = await route.fetch({
          url: "http://127.0.0.1:4173" + url.pathname + url.search,
        });
        return route.fulfill({ response });
      }
      expect(url.origin).toBe(origin);
      expect(request.headers().authorization).toBe("Bearer fixture-access");
      if (state.denied)
        return route.fulfill({
          status: 403,
          json: { detail: "Administrator required" },
        });
      if (url.pathname.endsWith("capabilities/"))
        return route.fulfill({
          json: {
            administrator: true,
            enabled: true,
            actor_id: 1,
            native_execution_enabled: false,
            native_adapters_accepted: false,
            editable_services: [
              "drive",
              "matrix",
              "gitlab",
              "minio",
              "monitor",
            ],
            readonly_services: ["jenkins", "hosting"],
            ...state.capOverrides,
          },
        });
      if (request.method() === "GET") {
        state.onList?.();
        if (state.holdList) await state.holdList;
        return route.fulfill({
          json: {
            count: state.rows.length,
            page: 1,
            page_size: 50,
            next_page: null,
            results: state.rows,
          },
        });
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      const headers = request.headers();
      state.calls.push({
        method: request.method(),
        path: url.pathname,
        body,
        etag: headers["if-match"],
        key: headers["idempotency-key"],
      });
      expect(headers["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/);
      if (state.failMutation)
        return route.fulfill({
          status: state.failMutation,
          json: { code: "stale_version" },
        });
      let user;
      if (url.pathname.endsWith("/users/")) {
        user = member(
          state.rows.length + 1,
          String(body.username),
          body.is_admin === true,
        );
        state.rows.push(user);
      } else {
        user = state.rows.find((u) =>
          url.pathname.includes(`/users/${u.id}/`),
        )!;
        const nativeAction = url.pathname.match(
          /\/native\/(gitlab|matrix|minio)\/(pause|resume)\/$/,
        );
        if (nativeAction) {
          expect(headers["if-match"]).toBeUndefined();
          const native = user.native[nativeAction[1]];
          const management = native.management!;
          if (body.expected_epoch !== management.authority_epoch)
            return route.fulfill({
              status: 412,
              json: { code: "stale_authority_epoch" },
            });
          const paused = nativeAction[2] === "pause";
          native.management = {
            ...management,
            paused,
            authority_epoch: management.authority_epoch + 1,
            pause_actor_id: paused ? 1 : null,
            safe_for_manual_changes:
              paused && !["running", "outcome_unknown"].includes(native.status),
          };
          return route.fulfill({
            status: 202,
            json: { management: native.management, replayed: false },
          });
        }
        expect(headers["if-match"]).toBe(user.etag);
        if (url.pathname.endsWith("/deactivate/")) user.is_active = false;
        else if (url.pathname.endsWith("/reactivate/")) user.is_active = true;
        else if (typeof body.is_admin === "boolean")
          user.is_admin = body.is_admin;
        else if (body.services)
          for (const [slug, granted] of Object.entries(body.services)) {
            expect(slug).not.toBe("jenkins");
            user.services[slug].assigned = user.services[slug].granted =
              granted === true;
            user.native[slug] = {
              desired: granted ? "enabled" : "blocked",
              observed: "unknown",
              status: "held",
              reason: "adoption_required",
            };
          }
        for (const field of ["email", "first_name", "last_name"] as const)
          if (typeof body[field] === "string") user[field] = body[field];
        user.version++;
        user.etag = '"' + user.version.toString(16).padStart(64, "0") + '"';
      }
      return route.fulfill({
        status: 202,
        json: { user, change_id: "fixture-change", replayed: false },
      });
    });
  return state;
}

test("Users tile opens standalone matrix with one admin column and read-only Jenkins", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  await fixture(page);
  await page.goto(portal + "/");
  const tile = page.getByRole("link", {
    name: "User administration",
    exact: true,
  });
  await expect(tile.locator("..")).toHaveCSS("display", "grid");
  await tile.click();
  await expect(page).toHaveURL(origin + "/");
  await expect(
    page.getByRole("table", { name: "User service permission matrix" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "is_admin", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("columnheader", { name: "is_staff", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "operator: is_admin", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "member: jenkins", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "member: hosting", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: info.outputPath("users-matrix.png") });
});

for (const grant of [false, "true", null])
  test(`Users tile requires exact grant ${JSON.stringify(grant)}`, async ({
    page,
  }) => {
    await fixture(page, grant);
    await page.goto(portal + "/");
    await expect(
      page.getByRole("link", { name: "Jenkins", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "User administration", exact: true }),
    ).toHaveCount(0);
  });

test("MinIO documents S3-only blocking without claiming session revocation", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(origin);
  const note = page.getByRole("note", { name: "MinIO blocking scope" });
  await expect(note).toContainText("blocking denies S3 access only");
  await expect(note).toContainText("Console sessions may still be issued");
  await expect(note).toContainText(
    "Existing unmanaged accounts are not adopted",
  );
  expect(state.calls).toHaveLength(0);
  state.denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(note).toHaveCount(0);
});

test("Matrix documents accepted lock and refresh without permanent revocation", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(origin);
  const note = page.getByRole("note", { name: "Matrix blocking scope" });
  await expect(note).toContainText(
    "native lock denies password login and sync",
  );
  await expect(note).toContainText(
    "Refresh may rotate tokens without restoring access",
  );
  await expect(note).toContainText("Sessions and keys are preserved");
  expect(state.calls).toHaveLength(0);
  state.denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(note).toHaveCount(0);
});

test("service update carries strong version and never makes Jenkins editable", async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows[1].services.jenkins.readonly = false; // client must still hard-exclude it
  await page.goto(origin + "/");
  await page
    .getByRole("checkbox", { name: "member: matrix", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "member: matrix", exact: true }),
  ).toBeChecked();
  await expect(page.getByText("Needs setup", { exact: true })).toBeVisible();
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0].body).toEqual({ services: { matrix: true } });
  await expect(
    page.getByRole("checkbox", { name: "member: jenkins", exact: true }),
  ).toBeDisabled();
});

test("create uses DOM password-manager value, clears it and does not persist it", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(origin + "/");
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("new-person");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("new@example.test");
  const secret = "Only-Synthetic-Password-2026!";
  await page.getByLabel(/^Initial password/).evaluate((input, value) => {
    (input as HTMLInputElement).value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, secret);
  await expect(
    page.locator("label").filter({ hasText: "Initial password" }),
  ).toHaveAttribute("data-shrink", "true");
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await expect(page.getByText("new-person", { exact: true })).toBeVisible();
  expect(state.calls[0].body.password).toBe(secret);
  await expect(page.getByLabel(/^Initial password/)).toHaveValue("");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(secret);
});

test("deactivation is confirmed, versioned and never deletion", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(origin + "/");
  const row = page.getByRole("row").filter({ hasText: "member@example.test" });
  await row.getByRole("button", { name: "Deactivate", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.calls).toHaveLength(0);
  await row.getByRole("button", { name: "Deactivate", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(row.getByText("Inactive", { exact: true })).toBeVisible();
  expect(state.calls[0].path).toBe("/api/user-admin/users/2/deactivate/");
  expect(state.calls[0].body).toEqual({});
  expect(state.calls.every((c) => c.method !== "DELETE")).toBe(true);
});

test("stale save clears the matrix and is not automatically replayed", async ({
  page,
}) => {
  const state = await fixture(page);
  state.failMutation = 412;
  await page.goto(origin + "/");
  await page
    .getByRole("checkbox", { name: "member: matrix", exact: true })
    .click();
  await expect(
    page.getByText(
      "The user changed elsewhere. Refresh and review before saving again.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(state.calls).toHaveLength(1);
});

test("live privilege loss clears both users and create form", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(origin + "/");
  await expect(page.getByRole("table")).toBeVisible();
  state.denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText(
      "Administrator access unavailable. No user data is displayed.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByLabel(/^Initial password/)).toHaveCount(0);
});

test("feature-off capability hides user data and mutations", async ({
  page,
}) => {
  const state = await fixture(page);
  state.capOverrides.enabled = false;
  await page.goto(origin + "/");
  await expect(
    page.getByText(
      "User administration is not enabled. No user data is displayed.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
});

test("profile editing sends only profile fields with original ETag and idempotency key", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(origin + "/");
  await page
    .getByRole("row")
    .filter({ hasText: "member@example.test" })
    .getByRole("button", { name: "Edit profile" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit user profile" });
  await dialog
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("updated@example.test");
  await dialog.getByRole("textbox", { name: "First name" }).fill("Synthetic");
  await dialog.getByRole("textbox", { name: "Last name" }).fill("Member");
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("table")).toContainText("updated@example.test");
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0]).toMatchObject({
    method: "PATCH",
    path: "/api/user-admin/users/2/",
    etag: '"' + "a".repeat(64) + '"',
    body: {
      email: "updated@example.test",
      first_name: "Synthetic",
      last_name: "Member",
    },
  });
  expect(state.rows[1].is_admin).toBe(false);
});

test("profile edit keeps original version across polling and clears on conflict", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(origin + "/");
  await page
    .getByRole("row")
    .filter({ hasText: "member@example.test" })
    .getByRole("button", { name: "Edit profile" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit user profile" });
  await dialog
    .getByRole("textbox", { name: "First name" })
    .fill("Unsaved draft");
  state.rows[1].email = "concurrent@example.test";
  state.rows[1].etag = '"' + "b".repeat(64) + '"';
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  // MUI hides the background table from accessibility while its modal is open.
  await expect(page.getByRole("table", { includeHidden: true })).toContainText(
    "concurrent@example.test",
  );
  await expect(
    dialog.getByRole("textbox", { name: "Email", exact: true }),
  ).toHaveValue("member@example.test");
  await expect(dialog.getByRole("textbox", { name: "First name" })).toHaveValue(
    "Unsaved draft",
  );
  state.failMutation = 412;
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.getByText(
      "The user changed elsewhere. Refresh and review before saving again.",
    ),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(state.calls[0].etag).toBe('"' + "a".repeat(64) + '"');
});

test("profile cancellation makes no request and privilege loss removes the draft", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(origin + "/");
  const edit = page
    .getByRole("row")
    .filter({ hasText: "member@example.test" })
    .getByRole("button", { name: "Edit profile" });
  await edit.click();
  let dialog = page.getByRole("dialog", { name: "Edit user profile" });
  await dialog
    .getByRole("textbox", { name: "First name" })
    .fill("Cancelled draft");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(state.calls).toHaveLength(0);
  await edit.click();
  dialog = page.getByRole("dialog", { name: "Edit user profile" });
  await expect(dialog.getByRole("textbox", { name: "First name" })).toHaveValue(
    "",
  );
  state.denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
});

test("Users restores only the host-only central session with exact-origin CSRF", async ({
  page,
}) => {
  await fixture(page);
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: "__Host-auth-fixture",
      value: "central-session",
      url: "https://auth.i3alumba.ru/",
      secure: true,
      httpOnly: true,
    },
  ]);
  let bridged = false;
  await page.route("https://auth.i3alumba.ru/api/**", async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type,x-csrftoken,authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    expect(request.headers().cookie).toContain(
      "__Host-auth-fixture=central-session",
    );
    if (new URL(request.url()).pathname === "/api/session/")
      return route.fulfill({
        headers,
        json: { authenticated: true, csrfToken: "fixture-csrf" },
      });
    expect(request.headers()["x-csrftoken"]).toBe("fixture-csrf");
    expect(request.headers().origin).toBe(origin);
    bridged = true;
    return route.fulfill({
      headers,
      json: { access: "fixture-access", refresh: "fixture-refresh" },
    });
  });
  await page.goto(origin + "/");
  await expect(page.getByRole("table")).toBeVisible();
  expect(bridged).toBe(true);
});

test("a late successful user list cannot restore data after privilege loss", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(origin + "/");
  await expect(page.getByRole("table")).toBeVisible();
  let release = () => {};
  state.holdList = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    state.onList = resolve;
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await arrived;
  state.denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("table")).toHaveCount(0);
  const oldResponse = page.waitForResponse(
    (r) => r.url().includes("/api/user-admin/users/") && r.status() === 200,
  );
  release();
  await oldResponse;
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByLabel(/^Initial password/)).toHaveCount(0);
});

function managedNative(overrides: Partial<NativeManagement> = {}): NativeState {
  return {
    desired: "enabled",
    observed: "unknown",
    status: "pending",
    reason: "",
    management: {
      can_manage: true,
      paused: false,
      authority_epoch: 0,
      pause_actor_id: null,
      safe_for_manual_changes: false,
      ...overrides,
    },
  };
}

test("native pause and own quiescent resume use explicit epoch not profile ETag", async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows[1].native.gitlab = managedNative();
  await page.goto(origin + "/");
  await page
    .getByRole("button", { name: "member: gitlab: pause native management" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(
    page.getByText(
      "Paused: safe for manual changes only while this pause remains in effect.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "member: gitlab: resume native management" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "member: gitlab: pause native management",
    }),
  ).toBeVisible();
  expect(state.calls.map((call) => call.path)).toEqual([
    "/api/user-admin/users/2/native/gitlab/pause/",
    "/api/user-admin/users/2/native/gitlab/resume/",
  ]);
  expect(state.calls.map((call) => call.body)).toEqual([
    { expected_epoch: 0 },
    { expected_epoch: 1 },
  ]);
  expect(state.calls.every((call) => call.etag === undefined)).toBe(true);
});

test("native confirmation keeps opening epoch across polling and does not replay stale intent", async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows[1].native.gitlab = managedNative();
  await page.goto(origin + "/");
  await page
    .getByRole("button", { name: "member: gitlab: pause native management" })
    .click();
  state.rows[1].native.gitlab.management!.authority_epoch = 9;
  const refreshed = page.waitForResponse((r) =>
    r.url().endsWith("/api/user-admin/users/?page=1"),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(
    page.getByText(
      "Native authority changed. Refresh and review the pause before retrying.",
    ),
  ).toBeVisible();
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0].body).toEqual({ expected_epoch: 0 });
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("unknown reservations and another administrator pause never offer forced resume", async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows[1].native.gitlab = {
    ...managedNative({ paused: true, authority_epoch: 1, pause_actor_id: 1 }),
    status: "outcome_unknown",
  };
  state.rows[1].native.matrix = managedNative({
    paused: true,
    authority_epoch: 1,
    pause_actor_id: 2,
    safe_for_manual_changes: true,
  });
  await page.goto(origin + "/");
  await expect(
    page.getByRole("button", {
      name: "member: gitlab: resume native management",
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "member: matrix: resume native management",
    }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      /running or unknown operations remain; manual changes are not safe/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/Only the pausing administrator can resume/),
  ).toBeVisible();
  expect(state.calls).toHaveLength(0);
});

test("authority loss closes native handoff dialog and removes every control", async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows[1].native.gitlab = managedNative();
  await page.goto(origin + "/");
  await page
    .getByRole("button", { name: "member: gitlab: pause native management" })
    .click();
  state.denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
});

test("unsafe native epoch fails closed rather than sending rounded authority", async ({
  page,
}) => {
  const state = await fixture(page);
  state.rows[1].native.gitlab = managedNative({
    authority_epoch: Number.MAX_SAFE_INTEGER + 1,
  });
  await page.goto(origin + "/");
  await expect(page.getByRole("alert")).toContainText(
    "No user data is displayed",
  );
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
});

for (const [phase, status, observed, reason, caption] of [
  ["create", "succeeded", "unbound", "", "Created; binding pending"],
  ["bind", "pending", "unbound", "", "Preparing access"],
  [
    "bind",
    "partial",
    "blocked",
    "native_enable_pending",
    "Bound; enable pending",
  ],
  [
    "enable",
    "partial",
    "enabled",
    "capability_unconfirmed",
    "Account configured; session guarantees unconfirmed",
  ],
  [
    "block",
    "unsupported",
    "enabled",
    "revocation_deferred",
    "Native revocation deferred; existing credentials may still work",
  ],
  [
    "enable",
    "unsupported",
    "blocked",
    "reenable_not_supported",
    "Re-enable requires operator attention",
  ],
  ["bind", "outcome_unknown", "unknown", "outcome_unknown", "Outcome unknown"],
]) {
  test(`provisioning status: ${phase}/${status}/${reason}`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.rows[1].native.matrix = {
      desired: "enabled",
      phase,
      status,
      observed,
      reason,
    };
    await page.goto(origin);
    await expect(page.getByText(caption, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("note", { name: "Provisioning-first scope" }),
    ).toContainText(
      "existing external sessions and credentials may continue to work",
    );
    state.denied = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("note", { name: "Provisioning-first scope" }),
    ).toHaveCount(0);
  });
}

test("mobile matrix scrolls internally rather than overflowing the page", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 1500 });
  await fixture(page);
  await page.goto(origin + "/");
  await expect(page.getByRole("table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    360,
  );
  await page.screenshot({ path: info.outputPath("users-mobile.png") });
});
