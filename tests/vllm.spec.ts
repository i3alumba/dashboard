import { test, expect, type Page, type BrowserContext } from "@playwright/test";
async function openChat(page: Page, context: BrowserContext, sso = false) {
  const state = { granted: true, bridges: 0, refreshes: 0 };
  const origin = "https://vllm.i3alumba.ru";
  if (!sso)
    await context.addCookies([
      {
        name: "access_token",
        value: "fixture-access",
        domain: ".i3alumba.ru",
        path: "/",
        secure: true,
      },
    ]);
  if (!sso)
    await context.addCookies([
      {
        name: "refresh_token",
        value: "fixture-refresh",
        domain: ".i3alumba.ru",
        path: "/",
        secure: true,
      },
    ]);
  await page.route("https://auth.i3alumba.ru/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: object = {
      services: { vllm: { enabled: state.granted, url: origin } },
    };
    if (path.endsWith("/session/"))
      json = { authenticated: true, csrfToken: "fixture-csrf" };
    if (path.endsWith("/session/token/")) {
      state.bridges++;
      expect(route.request().headers()["x-csrftoken"]).toBe("fixture-csrf");
      json = { access: "restored-access", refresh: "restored-refresh" };
    }
    if (path.endsWith("/token/refresh/")) {
      state.refreshes++;
      json = { access: "rotated-access", refresh: "rotated-refresh" };
    }
    return route.fulfill({
      json,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-headers":
          "authorization,content-type,x-csrftoken",
      },
    });
  });
  await page.route(origin + "/**", async (route) => {
    if (route.request().url().includes("/api/chat/completions"))
      return route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"choices":[{"delta":{"content":"<script>plain</script>"}}]}\n\ndata: [DONE]\n\n',
      });
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: "http://127.0.0.1:4173" + url.pathname + url.search,
    });
    return route.fulfill({ response });
  });
  await page.goto(origin);
  return state;
}

test("standalone chat streams plain text and does not persist messages", async ({
  page,
  context,
}) => {
  await openChat(page, context);
  await page.getByLabel("Message", { exact: true }).fill("Hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("<script>plain</script>");
  await page.reload();
  await expect(page.getByRole("log")).toBeEmpty();
});

for (const scenario of [
  "fragmented",
  "truncated",
  "reasoning-only",
  "abort",
] as const) {
  test(`parser ${scenario} handles terminal state and fragmented UTF-8`, async ({
    page,
  }) => {
    await page.route("https://auth.i3alumba.ru/**", (route) =>
      route.fulfill({ status: 401, json: {} }),
    );
    await page.goto("/");
    const result = await page.evaluate(async (scenario) => {
      const path = "/src/vllm/client.ts";
      const { generate } = await import(path);
      const controller = new AbortController();
      let content = "",
        thinking = 0;
      const raw =
        'data: {"choices":[{"delta":{"reasoning_content":"考える"}}]}\r\n\r\n' +
        (scenario === "reasoning-only"
          ? ""
          : 'data: {"choices":[{"delta":{"content":"Привет 🌍"}}]}\n\n') +
        (scenario === "truncated" ? "" : "data: [DONE]\n\n");
      const bytes = new TextEncoder().encode(raw);
      window.fetch = async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              for (const byte of bytes) stream.enqueue(new Uint8Array([byte]));
              stream.close();
            },
          }),
          { status: 200 },
        );
      if (scenario === "abort") controller.abort();
      try {
        await generate(
          [],
          controller.signal,
          (text: string) => (content += text),
          () => thinking++,
        );
        return { content, thinking, error: "" };
      } catch (error) {
        return { content, thinking, error: String(error) };
      }
    }, scenario);
    if (scenario === "fragmented") {
      expect(result.content).toBe("Привет 🌍");
      expect(result.error).toBe("");
      expect(result.thinking).toBe(1);
    } else if (scenario === "truncated")
      expect(result.error).toContain("interrupted");
    else if (scenario === "reasoning-only")
      expect(result.error).toContain("without a final answer");
    else expect(result.content).toBe("");
  });
}

test("revocation clears draft, denies sending, and stays mobile safe", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.install();
  const state = await openChat(page, context);
  await page.getByLabel("Message", { exact: true }).fill("private draft");
  state.granted = false;
  await page.clock.fastForward(15000);
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("logout immediately removes unsent draft and chat access", async ({
  page,
  context,
}) => {
  await openChat(page, context);
  await page.getByLabel("Message", { exact: true }).fill("private draft");
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByText("private draft", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toHaveCount(0);
});

test("standalone SSO uses CSRF bridge and concurrent chat refresh shares rotation", async ({
  page,
  context,
}) => {
  const state = await openChat(page, context, true);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  expect(state.bridges).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const path = "/src/vllm/client.ts";
    const { generate } = await import(path);
    let requests = 0;
    window.fetch = async () => {
      if (++requests <= 2) return new Response("", { status: 401 });
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
        { status: 200 },
      );
    };
    await Promise.all([
      generate([], new AbortController().signal, () => {}),
      generate([], new AbortController().signal, () => {}),
    ]);
  });
  expect(state.refreshes).toBe(1);
  expect(
    (await context.cookies()).find((cookie) => cookie.name === "refresh_token")
      ?.value,
  ).toBe("rotated-refresh");
});

test("Stop fences stale response and excludes interrupted context", async ({
  page,
  context,
}) => {
  await openChat(page, context);
  await page.evaluate(() => {
    let count = 0;
    const encoder = new TextEncoder();
    window.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const second = ++count > 1;
      if (
        second &&
        body.messages.some((message: { content: string }) =>
          message.content.includes("partial"),
        )
      )
        throw new Error("Interrupted assistant leaked into context");
      return new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"' +
                  (second ? "fresh" : "partial") +
                  '"}}]}\n\n',
              ),
            );
            if (second) {
              stream.enqueue(encoder.encode("data: [DONE]\n\n"));
              stream.close();
            } else
              window.addEventListener(
                "late-test-chunk",
                () => {
                  stream.enqueue(
                    encoder.encode(
                      'data: {"choices":[{"delta":{"content":"STALE"}}]}\n\n',
                    ),
                  );
                  stream.close();
                },
                { once: true },
              );
          },
        }),
        { status: 200 },
      );
    };
  });
  await page.getByLabel("Message", { exact: true }).fill("first");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("partial");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("second");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("fresh");
  await page.evaluate(() => window.dispatchEvent(new Event("late-test-chunk")));
  await expect(page.getByRole("log")).not.toContainText("STALE");
});

for (const status of [401, 403])
  test(`generation authorization ${status} clears conversation and draft immediately`, async ({
    page,
    context,
  }) => {
    await openChat(page, context);
    await page.evaluate((status) => {
      window.fetch = async () => new Response("", { status });
    }, status);
    await page.getByLabel("Message", { exact: true }).fill("secret request");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeDisabled();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
    await expect(page.getByRole("log")).toBeEmpty();
  });
