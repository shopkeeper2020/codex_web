import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MessageItem } from "../../api";
import { renderMessageItem } from "./MessageBlocks";

vi.mock("../../i18n/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("MessageBlocks file references", () => {
  it("keeps Windows absolute markdown link targets for local file references", () => {
    const item: MessageItem = {
      type: "assistant",
      id: "assistant-file-link",
      text: "[App.module.css](E:/cache/Desktop/codex_web/apps/web/src/app/App.module.css)",
    };

    const html = renderToStaticMarkup(
      renderMessageItem(item, "completed", {
        projectRoot: "E:\\cache\\Desktop\\codex_web",
      })!,
    );

    expect(html).toContain('title="apps/web/src/app/App.module.css"');
    expect(html).toContain("App.module.css");
  });
});
