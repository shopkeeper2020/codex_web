import type { Page, Route } from "@playwright/test";

type JsonBody = Record<string, unknown>;

type LockedAuthOptions = {
  validPassword?: string;
};

async function fulfillJson(
  route: Route,
  body: JsonBody,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function clearAuthMockRoutes(page: Page): Promise<void> {
  for (const pattern of ["**/api/auth/status", "**/api/auth/login"]) {
    await page.unroute(pattern).catch(() => undefined);
  }
}

export async function installLockedAuthMocks(
  page: Page,
  options: LockedAuthOptions = {},
): Promise<{ loginBodies: JsonBody[] }> {
  await clearAuthMockRoutes(page);

  const validPassword = options.validPassword ?? "codex-web-test-password";
  const loginBodies: JsonBody[] = [];

  await page.route("**/api/auth/status", async (route) => {
    await fulfillJson(route, {
      data: {
        authenticated: false,
        localBypass: false,
        sessionExpiresAtIso: null,
      },
    });
  });

  await page.route("**/api/auth/login", async (route) => {
    const body = route.request().postDataJSON() as JsonBody;
    loginBodies.push(body);
    if (body.password !== validPassword) {
      await fulfillJson(route, { error: "访问密码错误" }, 401);
      return;
    }

    await fulfillJson(route, {
      data: {
        authenticated: true,
        localBypass: false,
        sessionExpiresAtIso: "2026-06-05T00:00:00.000Z",
      },
    });
  });

  return { loginBodies };
}
