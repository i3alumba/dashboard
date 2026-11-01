import { expect, test } from "@playwright/test";

const services = [
  { slug: "drive", label: "Drive", icon: "FolderIcon" },
  { slug: "matrix", label: "Matrix", icon: "ChatIcon" },
  { slug: "gitlab", label: "GitLab", icon: "CodeIcon" },
  { slug: "minio", label: "MinIO", icon: "StorageIcon" },
  { slug: "jenkins", label: "Jenkins", icon: "BuildIcon" },
  { slug: "monitor", label: "Resource Monitor", icon: "AnalyticsIcon" },
];

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: "access_token", value: "fixture-access", url: baseURL! },
    { name: "refresh_token", value: "fixture-refresh", url: baseURL! },
  ]);
  await context.route("https://auth.i3alumba.ru/api/**", (route) => {
    const headers = {
      "access-control-allow-origin": baseURL!,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type,x-csrftoken,authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (new URL(route.request().url()).pathname !== "/api/access/")
      return route.fulfill({ status: 400, headers, json: {} });
    return route.fulfill({
      headers,
      json: {
        services: Object.fromEntries(
          services.map(({ slug }) => [
            slug,
            { enabled: true, url: `https://${slug}.i3alumba.ru` },
          ]),
        ),
      },
    });
  });
});

for (const { width, columns } of [
  { width: 320, columns: 1 },
  { width: 768, columns: 2 },
  { width: 1280, columns: 3 },
]) {
  test(`service tiles form ${columns} columns with large icon links at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const boxes = [];
    for (const { slug, label, icon } of services) {
      const tile = page.getByRole("link", { name: label, exact: true });
      await expect(tile).toBeVisible();
      await expect(tile).toHaveAttribute("href", `https://${slug}.i3alumba.ru`);
      await expect(tile).toHaveCSS("padding", "24px");
      await expect(tile.locator("a, button, [tabindex]")).toHaveCount(0);
      const image = tile.locator(`svg[data-testid="${icon}"]`);
      await expect(image).toHaveAttribute("aria-hidden", "true");
      await expect(image).toHaveCSS("width", "40px");
      await expect(image).toHaveCSS("height", "40px");
      const imageBox = (await image.boundingBox())!;
      const labelBox = (await tile.locator("span").boundingBox())!;
      expect(imageBox.y + imageBox.height).toBeLessThan(labelBox.y);
      const box = (await tile.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(150);
      expect(box.width).toBeGreaterThanOrEqual(150);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      boxes.push(box);
    }
    expect(new Set(boxes.map(({ y }) => y)).size).toBe(6 / columns);
    for (let index = 0; index < boxes.length; index++) {
      expect(boxes[index].y).toBe(
        boxes[Math.floor(index / columns) * columns].y,
      );
      if (index >= columns)
        expect(boxes[index].y).toBeGreaterThan(boxes[index - columns].y);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}

for (const mode of ["light", "dark"] as const) {
  test(`service tiles lift gently and remain readable in ${mode} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({
      colorScheme: mode,
      reducedMotion: "no-preference",
    });
    await page.goto("/");
    const tile = page.getByRole("link", { name: "Drive", exact: true });
    await expect(tile).toHaveCSS(
      "background-color",
      mode === "dark" ? "rgb(18, 30, 48)" : "rgb(255, 255, 255)",
    );
    await expect(tile).toHaveCSS(
      "color",
      mode === "dark" ? "rgb(230, 237, 247)" : "rgb(22, 36, 58)",
    );
    const restingBorder = await tile.evaluate(
      (element) => getComputedStyle(element).borderColor,
    );
    const restingShadow = await tile.evaluate(
      (element) => getComputedStyle(element).boxShadow,
    );
    await expect(tile).toHaveCSS("transition-duration", "0.18s, 0.18s, 0.18s");
    await tile.hover();
    await expect(tile).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -5)");
    expect(
      await tile.evaluate((element) => getComputedStyle(element).borderColor),
    ).not.toBe(restingBorder);
    expect(
      await tile.evaluate((element) => getComputedStyle(element).boxShadow),
    ).not.toBe(restingShadow);
    await page.mouse.move(0, 0);
    await expect(tile).toHaveCSS("transform", "none");
  });
}

test("keyboard navigation clearly focuses each service link and Enter follows its URL", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Drive", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark theme" }).focus();
  for (const { label } of services) {
    await page.keyboard.press("Tab");
    const tile = page.getByRole("link", { name: label, exact: true });
    await expect(tile).toBeFocused();
    await expect(tile).toHaveCSS("outline-style", "solid");
    await expect(tile).toHaveCSS("outline-width", "2px");
    await expect(tile).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -5)");
  }
  await context.route("https://monitor.i3alumba.ru/", (route) =>
    route.fulfill({ contentType: "text/html", body: "Mock monitor" }),
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("https://monitor.i3alumba.ru/");
});

test("reduced motion keeps hover and keyboard focus static but clearly indicated", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const tile = page.getByRole("link", { name: "Drive", exact: true });
  await expect(tile).toBeVisible();
  const restingBorder = await tile.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  await tile.hover();
  await expect(tile).toHaveCSS("transform", "none");
  await expect(tile).toHaveCSS("transition-duration", "0s");
  expect(
    await tile.evaluate((element) => getComputedStyle(element).borderColor),
  ).not.toBe(restingBorder);
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "Switch to dark theme" }).focus();
  await page.keyboard.press("Tab");
  await expect(tile).toBeFocused();
  await expect(tile).toHaveCSS("transform", "none");
  await expect(tile).toHaveCSS("transition-duration", "0s");
  await expect(tile).toHaveCSS("outline-style", "solid");
  await expect(tile).toHaveCSS("outline-width", "2px");
});
