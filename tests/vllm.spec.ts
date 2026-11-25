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

test("standalone chat renders inert HTML and does not persist messages", async ({
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

const richAnswer = `## A clearer starting point

Here is a **practical plan**, with a little math: $E = mc^2$.

- Start with the smallest useful step
- Check the result, then iterate

> Good questions make better starting points.

| Step | Outcome |
| --- | --- |
| Explore | Understand the constraints |
| Build | Make something useful |

\`\`\`python
for item in ["clarity", "progress"]:
    print(item)
\`\`\`

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

[Reference](https://example.com) [unsafe](javascript:alert(1))

![remote diagram](https://images.invalid/private.png)

<script>inert HTML</script>`;

async function richRoute(page: Page, content = richAnswer) {
  await page.route("**/api/chat/completions", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
    }),
  );
}

test("rich Markdown is semantic, safe, locally scrollable and copies literal code", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let externalImages = 0;
  await page.route("https://images.invalid/**", (route) => {
    externalImages++;
    return route.abort();
  });
  await openChat(page, context);
  await richRoute(page);
  await page.getByLabel("Message", { exact: true }).fill("Help me get started");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A clearer starting point" }),
  ).toBeVisible();
  await expect(page.locator("table")).toHaveCount(1);
  await expect(page.locator(".katex")).toHaveCount(2);
  await expect(page.locator(".markdown-message img")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "unsafe", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("log")).toContainText(
    "<script>inert HTML</script>",
  );
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('for item in ["clarity", "progress"]:\n    print(item)');
  expect(externalImages).toBe(0);
  for (const width of [320, 375, 720]) {
    await page.setViewportSize({ width, height: 812 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("composer prompts, keyboard, IME, copy failure and New chat", async ({
  page,
  context,
}) => {
  await openChat(page, context);
  const input = page.getByLabel("Message", { exact: true });
  await page.getByRole("button", { name: "Help me plan my week" }).click();
  await expect(input).toHaveValue("Help me plan my week");
  await input.fill(" ");
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  await input.fill("line one");
  await input.press("Shift+Enter");
  await input.press("a");
  await expect(input).toHaveValue("line one\na");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(input).toHaveValue("line one\na");
  await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  await expect(input).toHaveValue("line one\na");
  await input.press("Enter");
  await expect(page.getByRole("log")).toContainText("line one");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Denied")) },
    });
  });
  await page.getByRole("button", { name: "Copy", exact: true }).first().click();
  await expect(page.getByText("Copy failed")).toBeVisible();
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByRole("log")).toBeEmpty();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(input).toBeEnabled();
});

for (const width of [1440, 375])
  for (const mode of ["light", "dark"] as const) {
    test(`mocked chat screenshots ${width} ${mode}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await openChat(page, context);
      await expect(
        page.getByRole("heading", { name: "What can I help with?" }),
      ).toBeVisible();
      await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.screenshot({
        path: `/tmp/vllm-rich-chat-ui/${width}-${mode}-welcome.png`,
      });
      await richRoute(page);
      await page
        .getByLabel("Message", { exact: true })
        .fill("Help me turn an idea into a practical plan.");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "A clearer starting point" }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Send", exact: true }),
      ).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
        document.querySelector(".conversation-scroll")!.scrollTop = 0;
      });
      await page.screenshot({
        path: `/tmp/vllm-rich-chat-ui/${width}-${mode}-conversation.png`,
      });
      await page.locator(".code-block").scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("button", { name: "Copy code" }),
      ).toBeVisible();
      await expect(page.locator(".katex-display")).toBeVisible();
      await page.screenshot({
        path: `/tmp/vllm-rich-chat-ui/${width}-${mode}-code-math.png`,
      });
    });
  }

test("New chat fences an active response and scrolling preserves reading position", async ({
  page,
  context,
}) => {
  await openChat(page, context);
  await richRoute(
    page,
    Array.from(
      { length: 40 },
      (_, i) =>
        `## Section ${i}\n\nA useful explanation with enough detail to read.`,
    ).join("\n\n"),
  );
  await page.getByLabel("Message", { exact: true }).fill("Long answer");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Section 39", exact: true }),
  ).toHaveCount(1);
  await page.locator(".conversation-scroll").evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(
    page.getByRole("button", { name: "Jump to latest" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".conversation-scroll").evaluate((node) => node.scrollTop),
    )
    .toBe(0);
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect
    .poll(() =>
      page
        .locator(".conversation-scroll")
        .evaluate(
          (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
        ),
    )
    .toBeLessThan(96);
  await page.route("**/api/chat/completions", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route
      .fulfill({
        contentType: "text/event-stream",
        body: 'data: {"choices":[{"delta":{"content":"STALE"}}]}\n\ndata: [DONE]\n\n',
      })
      .catch(() => {});
  });
  await page.getByLabel("Message", { exact: true }).fill("Delayed response");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New chat" }).click();
  await page.waitForTimeout(700);
  await expect(page.getByRole("log")).toBeEmpty();
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await expect(page.getByText("Waiting…")).toHaveCount(0);
});

test("320px wide code, table and display math overflow only inside their containers", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openChat(page, context);
  const line = `print("${"literal_long_value_".repeat(40)}")`;
  const cell = "UnbrokenColumnValue".repeat(30);
  await richRoute(
    page,
    `\`\`\`python\n${line}\n\`\`\`\n\n| Wide |\n| --- |\n| ${cell} |\n\n$$\n${Array.from({ length: 50 }, (_, i) => `x_{${i}}`).join(" + ")}\n$$`,
  );
  await page.getByLabel("Message", { exact: true }).fill("Wide content");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".katex-display")).toHaveCount(1);
  for (const selector of [
    ".code-block pre",
    ".table-scroll",
    ".katex-display",
  ]) {
    const node = page.locator(selector);
    await expect
      .poll(() => node.evaluate((el) => el.scrollWidth - el.clientWidth), {
        message: selector,
      })
      .toBeGreaterThan(100);
    expect(await node.evaluate((el) => getComputedStyle(el).overflowX)).toBe(
      "auto",
    );
    await node.evaluate((el) => {
      el.scrollLeft = 100;
    });
    expect(await node.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(line);
});

test("streaming appends preserve reading position and Jump to latest resumes token follow", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openChat(page, context);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input) !== "/api/chat/completions")
        return original(input, init);
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              Object.assign(window, {
                appendChatFixture: (text: string) =>
                  controller.enqueue(
                    new TextEncoder().encode(
                      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
                    ),
                  ),
              });
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      );
    };
  });
  const append = (text: string) =>
    page.evaluate((text) => {
      (
        window as unknown as { appendChatFixture: (text: string) => void }
      ).appendChatFixture(text);
    }, text);
  const scroller = page.locator(".conversation-scroll");
  const bottomGap = () =>
    scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await page
    .getByLabel("Message", { exact: true })
    .fill("Stream a long answer");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await append(
    Array.from(
      { length: 60 },
      (_, i) => `Paragraph ${i}: some useful explanation.\n\n`,
    ).join(""),
  );
  await expect(page.getByRole("log")).toContainText("Paragraph 59");
  await expect.poll(bottomGap).toBeLessThan(5);
  await scroller.evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect(
    page.getByRole("button", { name: "Jump to latest" }),
  ).toBeVisible();
  const readingPosition = await scroller.evaluate((el) => el.scrollTop);
  await append("\n\nNew content while reading.\n\n".repeat(12));
  await expect(page.getByRole("log")).toContainText(
    "New content while reading.",
  );
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(readingPosition);
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect.poll(bottomGap).toBeLessThan(5);
  await append("\n\nFollowing the next token arrival.\n\n".repeat(12));
  await expect(page.getByRole("log")).toContainText(
    "Following the next token arrival.",
  );
  await expect.poll(bottomGap).toBeLessThan(5);
  await expect(
    page.getByRole("button", { name: "Jump to latest" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});
