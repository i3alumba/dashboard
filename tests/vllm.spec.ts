import { test, expect, type Page, type BrowserContext } from "@playwright/test";
async function openChat(page: Page, context: BrowserContext, sso = false) {
  const state = { granted: true, bridges: 0, refreshes: 0, userId: 1 };
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
    if (path.endsWith("/user/")) json = [{ id: state.userId, is_active: true }];
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
    if (new URL(route.request().url()).pathname === "/api/models")
      return route.fulfill({
        json: {
          data: [
            {
              id: "qwen3-next",
              max_model_len: 16384,
              output_budget: "remaining_context",
            },
          ],
        },
      });
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
  await page.waitForURL("**/login");
  await page.waitForLoadState("networkidle");
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

test("verified total context and automatic output budget", async ({
  page,
  context,
}) => {
  await openChat(page, context);
  await expect(page.getByText(/16,384 tokens total/)).toBeVisible();
  await page.route("**/api/chat/completions", (route) => {
    expect(route.request().postDataJSON()).not.toHaveProperty("max_tokens");
    return route.fulfill({
      status: 400,
      json: { error: { message: "Context exceeded: remaining_tokens=0" } },
    });
  });
  const composer = page.getByLabel("Message", { exact: true });
  await expect(composer).toHaveAttribute("maxlength", "262144");
  await composer.fill("large history");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Context exceeded: remaining_tokens=0"),
  ).toBeVisible();
});

test("escaped composer wire overflow is rejected without inference fetch", async ({
  page,
  context,
}) => {
  await openChat(page, context);
  let calls = 0;
  await page.route("**/api/chat/completions", (route) => {
    calls++;
    return route.fulfill({ status: 500 });
  });
  await page
    .getByLabel("Message", { exact: true })
    .fill("\u0001".repeat(180000));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText(
      "Conversation request exceeds 1 MiB. Start a new chat or shorten it.",
    ),
  ).toBeVisible();
  expect(calls).toBe(0);
});

const usageTitle =
  "4014/16384. Контекст последнего завершённого запроса: история, шаблон, рассуждения и ответ";
test("completed server usage includes reasoning, exact tooltip and new chat reset", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "light" });
  await openChat(page, context);
  await expect(page.getByText("0.0%/16k", { exact: true })).toBeVisible();
  await page.route("**/api/chat/completions", (route) => {
    expect(route.request().postDataJSON().stream_options).toEqual({
      include_usage: true,
    });
    return route.fulfill({
      contentType: "text/event-stream",
      body:
        'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}],"usage":null}\n\n' +
        'data: {"choices":[{"delta":{"content":"Final answer"}}],"usage":null}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":3000,"completion_tokens":1014,"total_tokens":4014}}\n\n' +
        "data: [DONE]\n\n",
    });
  });
  await page.getByLabel("Message", { exact: true }).fill("Hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Final answer");
  const usage = page.getByLabel(usageTitle, { exact: true });
  await expect(usage).toHaveText("24.5%/16k");
  await usage.hover();
  await expect(page.getByRole("tooltip")).toContainText("4014/16384");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(usage).toHaveText("24.5%/16k");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByText("0.0%/16k", { exact: true })).toBeVisible();
});

for (const [name, usage] of [
  ["missing", null],
  [
    "boolean",
    { prompt_tokens: true, completion_tokens: 4013, total_tokens: 4014 },
  ],
  [
    "string",
    { prompt_tokens: "3000", completion_tokens: 1014, total_tokens: 4014 },
  ],
  [
    "sum mismatch",
    { prompt_tokens: 3000, completion_tokens: 1, total_tokens: 4014 },
  ],
  [
    "overflow",
    { prompt_tokens: 16000, completion_tokens: 1000, total_tokens: 17000 },
  ],
  [
    "negative",
    { prompt_tokens: -1, completion_tokens: 4015, total_tokens: 4014 },
  ],
  [
    "fraction",
    { prompt_tokens: 3000.5, completion_tokens: 1013.5, total_tokens: 4014 },
  ],
] as const) {
  test(`server usage ${name} stays unknown`, async ({ page, context }) => {
    await openChat(page, context);
    await page.route("**/api/chat/completions", (route) =>
      route.fulfill({
        contentType: "text/event-stream",
        body:
          'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n' +
          `data: ${JSON.stringify({ choices: [], usage })}\n\n` +
          "data: [DONE]\n\n",
      }),
    );
    await page.getByLabel("Message", { exact: true }).fill("Hello");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("answer");
    await expect(page.getByText("—/16k", { exact: true })).toBeVisible();
  });
}

test("usage chunk without DONE is never a completed measurement", async ({
  page,
  context,
}) => {
  await openChat(page, context);
  await page.route("**/api/chat/completions", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":3000,"completion_tokens":1014,"total_tokens":4014}}\n\n',
    }),
  );
  await page.getByLabel("Message", { exact: true }).fill("Hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Response interrupted before completion"),
  ).toBeVisible();
  await expect(page.getByText("—/16k", { exact: true })).toBeVisible();
});

test("usage request refresh retries identical guarded UTF8 JSON", async ({
  page,
  context,
}) => {
  await openChat(page, context);
  const bodies: string[] = [];
  await page.route("**/api/chat/completions", (route) => {
    bodies.push(route.request().postData()!);
    if (bodies.length === 1) return route.fulfill({ status: 401 });
    return route.fulfill({
      contentType: "text/event-stream",
      body:
        'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":3000,"completion_tokens":1014,"total_tokens":4014}}\n\n' +
        "data: [DONE]\n\n",
    });
  });
  const totals = await page.evaluate(async () => {
    const path = "/src/vllm/client.ts";
    const { generate } = await import(path);
    const totals: number[] = [];
    await generate(
      [{ role: "user", content: '雪\\"' }],
      new AbortController().signal,
      () => {},
      () => {},
      (usage: { total_tokens: number }) => totals.push(usage.total_tokens),
      16384,
    );
    return totals;
  });
  await page.waitForLoadState("networkidle");
  expect(totals).toEqual([4014]);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(JSON.parse(bodies[0]).stream_options).toEqual({ include_usage: true });
});

test("context indicator never advertises unverified model limit", async ({
  page,
  context,
}) => {
  await openChat(page, context);
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: { data: [{ id: "qwen3-next", max_model_len: 4096 }] },
    }),
  );
  await Promise.all([page.waitForResponse("**/api/models"), page.reload()]);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await expect(page.getByText(/(?:%\/16k|—\/16k)/)).toHaveCount(0);
});

for (const scenario of [
  "user switch",
  "unknown identity",
  "new chat",
  "stop",
] as const) {
  test(`late completed usage after ${scenario} cannot repopulate counter`, async ({
    page,
    context,
  }) => {
    await page.clock.install();
    const state = await openChat(page, context);
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = async (input, options) => {
        if (!String(input).includes("chat/completions"))
          return original(input, options);
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"old partial"}}]}\n\n',
                ),
              );
              window.addEventListener(
                "late-usage",
                () => {
                  stream.enqueue(
                    encoder.encode(
                      'data: {"choices":[],"usage":{"prompt_tokens":3000,"completion_tokens":1014,"total_tokens":4014}}\n\ndata: [DONE]\n\n',
                    ),
                  );
                  stream.close();
                },
                { once: true },
              );
            },
          }),
        );
      };
    });
    await page.getByLabel("Message", { exact: true }).fill("A prompt");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("old partial");
    if (scenario === "user switch" || scenario === "unknown identity") {
      state.userId = 2;
      if (scenario === "unknown identity")
        await page.route("https://auth.i3alumba.ru/api/user/", (route) =>
          route.fulfill({ status: 503 }),
        );
      await context.addCookies([
        {
          name: "access_token",
          value: "user-B",
          domain: ".i3alumba.ru",
          path: "/",
          secure: true,
        },
      ]);
      await page.clock.runFor(15001);
      await expect(page.getByRole("log")).toBeEmpty();
    } else {
      await page
        .getByRole("button", {
          name: scenario === "new chat" ? "New chat" : "Stop",
          exact: true,
        })
        .click();
    }
    await page.evaluate(() => window.dispatchEvent(new Event("late-usage")));
    await expect(page.getByText("24.5%/16k", { exact: true })).toHaveCount(0);
    if (scenario === "unknown identity")
      await expect(page.getByLabel("Message", { exact: true })).toBeDisabled();
    else {
      await expect(
        page.getByText(scenario === "new chat" ? "0.0%/16k" : "—/16k", {
          exact: true,
        }),
      ).toBeVisible();
    }
    await page.waitForLoadState("networkidle");
  });
}

test("nonfinite raw usage counts are ignored", async ({ page, context }) => {
  await openChat(page, context);
  await page.route("**/api/chat/completions", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":1e999,"completion_tokens":1,"total_tokens":1e999}}\n\ndata: [DONE]\n\n',
    }),
  );
  await page.getByLabel("Message", { exact: true }).fill("Hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("answer");
  await expect(page.getByText("—/16k", { exact: true })).toBeVisible();
});

test("same verified user after access refresh may publish completed usage", async ({
  page,
  context,
}) => {
  const state = await openChat(page, context);
  let calls = 0;
  await page.route("**/api/chat/completions", (route) => {
    if (++calls === 1) return route.fulfill({ status: 401 });
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"refreshed answer"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":3000,"completion_tokens":1014,"total_tokens":4014}}\n\ndata: [DONE]\n\n',
    });
  });
  await page.getByLabel("Message", { exact: true }).fill("Hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("24.5%/16k", { exact: true })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("refreshed answer");
  expect(state.refreshes).toBe(1);
  await page.waitForLoadState("networkidle");
});
