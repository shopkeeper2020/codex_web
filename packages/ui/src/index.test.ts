import { describe, expect, it } from "vitest";
import { codexWebTokens } from "./index";

describe("codexWebTokens", () => {
  it("exports CSS variables used by the web app token sheet", () => {
    expect(codexWebTokens.colorBackgroundApp).toBe("var(--color-bg-app)");
    expect(codexWebTokens.colorTextPrimary).toBe("var(--color-text-primary)");
    expect(codexWebTokens.radiusControl).toBe("var(--radius-control)");
    expect(codexWebTokens.sidebarWidth).toBe("var(--size-sidebar-default)");
  });

  it("does not expose stale cw-prefixed variables", () => {
    expect(
      Object.values(codexWebTokens).some((value) => value.includes("--cw-")),
    ).toBe(false);
  });
});
