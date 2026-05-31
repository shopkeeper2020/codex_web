import type { Page, Route } from "@playwright/test";

type JsonBody = Record<string, unknown>;

type EmptyThreadListOptions = {
  deferThreadList?: boolean;
};

async function fulfillJson(route: Route, body: JsonBody): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function clearMockRoutes(page: Page): Promise<void> {
  for (const pattern of [
    "**/api/domain/threads**",
    "**/api/domain/thread-detail**",
    "**/api/approvals",
  ]) {
    await page.unroute(pattern).catch(() => undefined);
  }
}

export async function installEmptyThreadListMocks(
  page: Page,
  options: EmptyThreadListOptions = {},
): Promise<{ releaseThreadList: () => void }> {
  await clearMockRoutes(page);

  let releaseThreadList: () => void = () => undefined;
  const threadListGate = options.deferThreadList
    ? new Promise<void>((resolve) => {
        releaseThreadList = resolve;
      })
    : Promise.resolve();

  await page.route("**/api/domain/threads**", async (route) => {
    await threadListGate;
    await fulfillJson(route, {
      data: {
        projects: [],
        threads: [],
        nextCursor: null,
        backwardsCursor: null,
      },
    });
  });

  await page.route("**/api/domain/thread-detail**", async (route) => {
    await fulfillJson(route, {
      data: {
        thread: null,
        turns: [],
      },
      source: "e2e-mock",
    });
  });

  await page.route("**/api/approvals", async (route) => {
    await fulfillJson(route, { data: [] });
  });

  if (!options.deferThreadList) releaseThreadList();
  return { releaseThreadList };
}
