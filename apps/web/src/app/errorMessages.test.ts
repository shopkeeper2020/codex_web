import { describe, expect, it } from "vitest";
import { userFacingErrorMessage } from "./errorMessages";

describe("userFacingErrorMessage", () => {
  it("explains owner readiness failures while creating a thread", () => {
    expect(
      userFacingErrorMessage(
        new Error("official-ipc-owner-not-ready"),
        "create thread failed",
      ),
    ).toContain("官方同步通道还没准备好");
  });

  it("explains official-owned archive protection", () => {
    expect(
      userFacingErrorMessage(
        new Error("official-owner-action-required:thread-archive"),
        "archive thread failed",
      ),
    ).toContain("暂时不直接归档");
  });

  it("explains unknown owner turn protection", () => {
    expect(
      userFacingErrorMessage(
        new Error("official-owner-required:no cached owner"),
        "send failed",
      ),
    ).toContain("还没有确认这个会话");
  });

  it("keeps unexpected backend messages visible", () => {
    expect(
      userFacingErrorMessage(new Error("custom failure"), "fallback"),
    ).toBe("custom failure");
  });

  it("hides transient empty rollout file paths", () => {
    expect(
      userFacingErrorMessage(
        new Error(
          "failed to read thread: thread-store internal error: failed to read thread C:\\Users\\lwm\\.codex\\sessions\\2026\\06\\01\\rollout-thread.jsonl: rollout at C:\\Users\\lwm\\.codex\\sessions\\2026\\06\\01\\rollout-thread.jsonl is empty",
        ),
        "thread detail failed",
      ),
    ).toBe("新会话还在初始化，内容马上会同步完成。");
  });

  it("uses fallback for non-error values", () => {
    expect(userFacingErrorMessage("bad", "fallback")).toBe("fallback");
  });
});
