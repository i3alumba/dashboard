import { expect, test } from "@playwright/test";

for (const enabled of [true, false, "true", null]) {
  test(`monitor card requires exact Auth grant: ${JSON.stringify(enabled)}`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "access_token", value: "fixture-access", url: baseURL! },
      { name: "refresh_token", value: "fixture-refresh", url: baseURL! },
    ]);
    const headers = {
      "access-control-allow-origin": baseURL!,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type,x-csrftoken,authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    };
    await context.route("https://auth.i3alumba.ru/api/**", async (route) => {
      if (route.request().method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      if (new URL(route.request().url()).pathname === "/api/access/") {
        expect(route.request().headers().authorization).toBe(
          "Bearer fixture-access",
        );
        return route.fulfill({
          headers,
          json: {
            services: {
              monitor: { enabled, url: "https://monitor.i3alumba.ru" },
              unknown: { enabled: true, url: "https://unknown.example" },
            },
          },
        });
      }
      return route.fulfill({ status: 400, headers, json: {} });
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Your Services" }),
    ).toBeVisible();
    const card = page.getByRole("link", {
      name: "Resource Monitor",
      exact: true,
    });
    if (enabled === true) {
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("href", "https://monitor.i3alumba.ru");
    } else {
      await expect(card).toHaveCount(0);
    }
    await expect(page.getByRole("link", { name: "unknown" })).toHaveCount(0);
  });
}
