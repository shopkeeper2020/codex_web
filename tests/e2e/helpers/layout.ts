import type { Page } from "@playwright/test";

type OverflowOffender = {
  tag: string;
  className: string;
  ariaLabel: string | null;
  text: string;
  left: number;
  right: number;
  width: number;
  scrollWidth: number;
  clientWidth: number;
  overflowX: string;
};

type OverflowDebug = {
  url: string;
  viewportWidth: number;
  documentElementScrollWidth: number;
  bodyScrollWidth: number;
  offenders: OverflowOffender[];
};

export async function getHorizontalOverflowDebug(
  page: Page,
): Promise<OverflowDebug> {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const seen = new Set<Element>();
    const offenders: OverflowOffender[] = [];
    const selectors = [
      "html",
      "body",
      "#root",
      "main",
      "[aria-label='会话']",
      "[aria-label='Skills menu']",
      "[class*='app']",
      "[class*='main']",
      "[class*='chatViewport']",
      "[class*='chatColumn']",
      "[class*='composerDock']",
      "[class*='composer']",
      "[class*='composerControls']",
      "[class*='skillsMenu']",
      "[class*='settingsPanel']",
      "[class*='drawerPanel']",
      "pre",
      "code",
    ];

    const add = (element: Element) => {
      if (seen.has(element)) return;
      seen.add(element);
      const rect = element.getBoundingClientRect();
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(element);
      offenders.push({
        tag: element.tagName.toLowerCase(),
        className:
          typeof htmlElement.className === "string"
            ? htmlElement.className
            : "",
        ariaLabel: element.getAttribute("aria-label"),
        text: (element.textContent ?? "").replace(/\s+/g, " ").slice(0, 96),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        scrollWidth: htmlElement.scrollWidth,
        clientWidth: htmlElement.clientWidth,
        overflowX: style.overflowX,
      });
    };

    for (const element of document.querySelectorAll(selectors.join(","))) {
      const rect = element.getBoundingClientRect();
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(element);
      const hasInternalScroll =
        htmlElement.scrollWidth > htmlElement.clientWidth + 1 &&
        style.overflowX !== "auto" &&
        style.overflowX !== "scroll";
      if (
        rect.left < -1 ||
        rect.right > viewportWidth + 1 ||
        hasInternalScroll
      ) {
        add(element);
      }
    }

    offenders.sort((a, b) => {
      const aExcess = Math.max(
        a.right - viewportWidth,
        a.scrollWidth - a.clientWidth,
      );
      const bExcess = Math.max(
        b.right - viewportWidth,
        b.scrollWidth - b.clientWidth,
      );
      return bExcess - aExcess;
    });

    return {
      url: window.location.href,
      viewportWidth,
      documentElementScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders: offenders.slice(0, 12),
    };
  });
}

export async function expectNoHorizontalOverflow(
  page: Page,
  label = "page",
): Promise<void> {
  try {
    await page.waitForFunction(
      () =>
        Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        ) <=
        window.innerWidth + 1,
      undefined,
      { polling: "raf", timeout: 15_000 },
    );
  } catch (error) {
    const debug = await getHorizontalOverflowDebug(page);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${label} has horizontal overflow.\n${JSON.stringify(
        debug,
        null,
        2,
      )}\n${message}`,
    );
  }
}
