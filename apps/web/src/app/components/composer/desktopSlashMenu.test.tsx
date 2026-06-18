import type { SetStateAction } from "react";
import { describe, expect, it } from "vitest";
import type { ThreadTokenUsage } from "@codex-web/domain";
import type { RuntimeCollaborationModeOption, SkillOption } from "../../../api";
import {
  buildDesktopSlashMenuItems,
  formatContextWindowUsageMeta,
} from "./desktopSlashMenu";

function tokenUsage(totalTokens: number, lastTokens: number): ThreadTokenUsage {
  return {
    total: {
      totalTokens,
      inputTokens: totalTokens,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    last: {
      totalTokens: lastTokens,
      inputTokens: lastTokens,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    modelContextWindow: 258400,
  };
}

const planMode: RuntimeCollaborationModeOption = {
  name: "Plan",
  mode: "plan",
  model: null,
  reasoningEffort: null,
  developerInstructions: null,
};

const browserSkill: SkillOption = {
  id: "browser",
  name: "browser",
  displayName: "Browser",
  description: "Browser lets Codex open and control the in-app browser",
  shortDescription: "Control the in-app browser",
  path: "C:/skills/browser/SKILL.md",
  cwd: "C:/workspace/codex_web",
  scope: "user",
  enabled: true,
  brandColor: null,
};

describe("desktop slash menu", () => {
  it("orders core entries like Codex Desktop and keeps skills in their group", () => {
    let collaborationModeName: string | null = null;
    let selectedSkillIds: string[] = [];
    const items = buildDesktopSlashMenuItems({
      activeSteerMode: false,
      collaborationModeName,
      onCompactThread: () => undefined,
      planCollaborationMode: planMode,
      selectedEffortLabel: "超高",
      selectedModelLabel: "GPT-5.5",
      selectedSkillIds,
      setCollaborationModeName: (value: SetStateAction<string | null>) => {
        collaborationModeName =
          typeof value === "function" ? value(collaborationModeName) : value;
      },
      setSelectedSkillIds: (value: SetStateAction<string[]>) => {
        selectedSkillIds =
          typeof value === "function" ? value(selectedSkillIds) : value;
      },
      skills: [browserSkill],
      tokenUsage: tokenUsage(4_083_976, 184_881),
    });

    expect(
      items.filter((item) => item.group === "功能").map((item) => item.label),
    ).toEqual([
      "IDE 上下文",
      "MCP",
      "个性",
      "代码审查",
      "侧边",
      "压缩",
      "反馈",
      "宠物",
      "推理模式",
      "模型",
      "派生",
      "状态",
      "目标",
      "计划模式",
      "记忆",
    ]);
    expect(items.map((item) => item.label)).not.toContain("引导当前回复");
    expect(items.map((item) => item.label)).not.toContain("排队下一条");
    expect(items.at(-1)).toMatchObject({
      group: "技能",
      label: "Browser",
      meta: "user",
    });
  });

  it("uses latest-window token usage for compact menu context", () => {
    expect(formatContextWindowUsageMeta(tokenUsage(4_083_976, 184_881))).toBe(
      "已使用 72%",
    );

    const compact = buildDesktopSlashMenuItems({
      activeSteerMode: false,
      collaborationModeName: null,
      onCompactThread: () => undefined,
      planCollaborationMode: planMode,
      selectedEffortLabel: "超高",
      selectedModelLabel: "GPT-5.5",
      selectedSkillIds: [],
      setCollaborationModeName: () => undefined,
      setSelectedSkillIds: () => undefined,
      skills: [],
      tokenUsage: tokenUsage(4_083_976, 184_881),
    }).find((item) => item.id === "desktop:compact");

    expect(compact?.description).toBe("压缩此会话的上下文（已使用 72%）");
    expect(compact?.description).not.toContain("1580%");
  });
});
