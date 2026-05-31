import { expect, test } from "@playwright/test";
import {
  approvalId,
  approvalProjectRoot,
  approvalThreadId,
  installApprovalCardMocks,
} from "./fixtures/approvalCard";
import { expectNoHorizontalOverflow } from "./helpers/layout";

test.describe("approval card", () => {
  test("renders pending approval details and completes one decision", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "审批卡片决策闭环只在 desktop project 验证",
    );

    const { decisionBodies, releaseDecision } =
      await installApprovalCardMocks(page);

    await page.goto(`/thread/${approvalThreadId}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("heading", { name: "Apply guarded file changes" }),
    ).toBeVisible();
    await expect(page.getByText("1 个待处理")).toBeVisible();
    await expect(
      page.getByText("Codex wants to apply a focused E2E patch."),
    ).toBeVisible();
    await expect(
      page.getByText("apply_patch --check tests/e2e/approval-card.spec.ts"),
    ).toBeVisible();
    await expect(page.getByText(`cwd: ${approvalProjectRoot}`)).toBeVisible();
    await expect(page.getByText(`root: ${approvalProjectRoot}`)).toBeVisible();
    await expect(
      page.getByText("file: tests/e2e/approval-card.spec.ts"),
    ).toBeVisible();
    await expect(page.getByText("2 个变更文件")).toBeVisible();
    await expect(
      page.getByText("tests/e2e/approval-card.spec.ts").first(),
    ).toBeVisible();
    await expect(
      page.getByText("apps/web/src/app/components/MessageBlocks.tsx"),
    ).toBeVisible();
    await expect(
      page.getByText("allow apply_patch in codex_web"),
    ).toBeVisible();
    await expect(page.getByText("Diff", { exact: true })).toBeVisible();
    await expect(page.getByText("+expect(decisionBody).toEqual")).toHaveCount(0);
    await page.getByRole("button", { name: "展开内容" }).last().click();
    await expect(page.getByText("+expect(decisionBody).toEqual")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "批准", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "拒绝", exact: true }),
    ).toBeEnabled();

    await page.getByRole("button", { name: "批准", exact: true }).click();

    await expect.poll(() => decisionBodies.length).toBe(1);
    expect(decisionBodies[0]).toEqual({ id: approvalId, decision: "accept" });

    const processingButton = page.getByRole("button", {
      name: "处理中",
      exact: true,
    });
    await expect(processingButton).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "拒绝", exact: true }),
    ).toBeDisabled();

    const box = await processingButton.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await page.waitForTimeout(100);
    expect(decisionBodies).toHaveLength(1);

    releaseDecision();
    await expect(
      page.getByRole("heading", { name: "Apply guarded file changes" }),
    ).toHaveCount(0);
    await expect(page.getByText("1 个待处理")).toHaveCount(0);
  });

  test("keeps approval decisions usable on mobile", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("mobile"),
      "审批卡片移动端回归只在 mobile project 验证",
    );

    const { decisionBodies, releaseDecision } =
      await installApprovalCardMocks(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/thread/${approvalThreadId}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("heading", { name: "Apply guarded file changes" }),
    ).toBeVisible();
    await expect(page.getByText("1 个待处理")).toBeVisible();
    await expect(
      page.getByText("apply_patch --check tests/e2e/approval-card.spec.ts"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "批准", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "拒绝并停止", exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, "mobile approval card");

    await page.getByRole("button", { name: "拒绝并停止", exact: true }).click();

    await expect.poll(() => decisionBodies.length).toBe(1);
    expect(decisionBodies[0]).toEqual({
      id: approvalId,
      decision: "cancel",
    });
    await expect(
      page.getByRole("button", { name: "处理中", exact: true }),
    ).toBeDisabled();
    await expectNoHorizontalOverflow(page, "mobile approval card deciding");

    releaseDecision();
    await expect(
      page.getByRole("heading", { name: "Apply guarded file changes" }),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "mobile approval card resolved");
  });
});
