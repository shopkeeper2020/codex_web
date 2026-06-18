import {
  Archive,
  Brain,
  FileCode2,
  FileText,
  GitBranch,
  Laptop,
  MessageSquare,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { ReactElement, SetStateAction } from "react";
import type { ThreadTokenUsage } from "@codex-web/domain";
import type { RuntimeCollaborationModeOption, SkillOption } from "../../../api";

export type SlashMenuItem = {
  id: string;
  group: "功能" | "技能";
  label: string;
  description: string;
  meta?: string;
  icon: ReactElement;
  selected?: boolean;
  disabled?: boolean;
  closeOnApply?: boolean;
  apply: () => void;
};

export function formatContextWindowUsageMeta(
  tokenUsage: ThreadTokenUsage | null | undefined,
): string | null {
  const used = tokenUsage?.last.totalTokens ?? 0;
  const windowSize = tokenUsage?.modelContextWindow ?? 0;
  if (used <= 0 || windowSize <= 0) return null;
  return `已使用 ${Math.round((used / windowSize) * 100)}%`;
}

export function buildDesktopSlashMenuItems({
  activeSteerMode,
  collaborationModeName,
  onCompactThread,
  planCollaborationMode,
  selectedEffortLabel,
  selectedModelLabel,
  selectedSkillIds,
  setCollaborationModeName,
  setSelectedSkillIds,
  skills,
  tokenUsage,
}: {
  activeSteerMode: boolean;
  collaborationModeName: string | null;
  onCompactThread?: () => Promise<void> | void;
  planCollaborationMode: RuntimeCollaborationModeOption | null;
  selectedEffortLabel: string;
  selectedModelLabel: string;
  selectedSkillIds: string[];
  setCollaborationModeName: (value: SetStateAction<string | null>) => void;
  setSelectedSkillIds: (value: SetStateAction<string[]>) => void;
  skills: SkillOption[];
  tokenUsage: ThreadTokenUsage | null | undefined;
}): SlashMenuItem[] {
  const items: SlashMenuItem[] = [];
  const addUnavailableItem = (
    id: string,
    label: string,
    description: string,
    icon: ReactElement,
    meta?: string,
  ) => {
    items.push({
      id,
      group: "功能",
      label,
      description,
      icon,
      meta,
      disabled: true,
      apply: () => undefined,
    });
  };

  addUnavailableItem(
    "desktop:ide-context",
    "IDE 上下文",
    "包含当前选择、打开的文件以及其他来自 IDE 的上下文",
    <Laptop size={15} />,
  );
  addUnavailableItem(
    "desktop:mcp",
    "MCP",
    "显示 MCP 服务器状态",
    <FileCode2 size={15} />,
  );
  addUnavailableItem(
    "desktop:personality",
    "个性",
    "选择 Codex 的回应方式",
    <Sparkles size={15} />,
  );
  addUnavailableItem(
    "desktop:code-review",
    "代码审查",
    "审查未暂存的更改，或与某个分支进行比较",
    <ShieldCheck size={15} />,
  );
  addUnavailableItem(
    "desktop:side",
    "侧边",
    "在临时分支中发起侧边对话",
    <MessageSquare size={15} />,
  );

  const compactMeta = formatContextWindowUsageMeta(tokenUsage);
  items.push({
    id: "desktop:compact",
    group: "功能",
    label: "压缩",
    description: compactMeta
      ? `压缩此会话的上下文（${compactMeta}）`
      : "压缩此会话的上下文",
    icon: <Archive size={15} />,
    disabled: !onCompactThread,
    apply: () => {
      void onCompactThread?.();
    },
  });

  addUnavailableItem(
    "desktop:feedback",
    "反馈",
    "发送有关此聊天的反馈",
    <MessageSquare size={15} />,
  );
  addUnavailableItem(
    "desktop:pet",
    "宠物",
    "唤醒或收起桌面宠物",
    <Sparkles size={15} />,
  );
  addUnavailableItem(
    "desktop:reasoning",
    "推理模式",
    "当前推理强度来自官方模型列表",
    <Brain size={15} />,
    selectedEffortLabel,
  );
  addUnavailableItem(
    "desktop:model",
    "模型",
    "当前模型来自官方 model/list",
    <Settings size={15} />,
    selectedModelLabel,
  );
  addUnavailableItem(
    "desktop:fork",
    "派生",
    "为此对话创建分支至本地或全新工作树",
    <GitBranch size={15} />,
  );
  addUnavailableItem(
    "desktop:status",
    "状态",
    "显示对话 ID、上下文使用情况及额度限制",
    <ShieldCheck size={15} />,
  );
  addUnavailableItem(
    "desktop:goal",
    "目标",
    "设置 Codex 将持续努力实现的目标",
    <Brain size={15} />,
  );

  if (planCollaborationMode) {
    const selected = collaborationModeName === planCollaborationMode.name;
    items.push({
      id: "collaboration:plan",
      group: "功能",
      label: "计划模式",
      description: "开启计划模式",
      icon: <FileText size={15} />,
      selected,
      disabled: activeSteerMode,
      apply: () => {
        setCollaborationModeName(selected ? null : planCollaborationMode.name);
      },
    });
  } else {
    addUnavailableItem(
      "desktop:plan-mode",
      "计划模式",
      "开启计划模式",
      <FileText size={15} />,
    );
  }

  addUnavailableItem(
    "desktop:memory",
    "记忆",
    "生成或管理记忆",
    <Archive size={15} />,
  );

  skills.forEach((skill) => {
    const selected = selectedSkillIds.includes(skill.id);
    items.push({
      id: `skill:${skill.id}`,
      group: "技能",
      label: skill.displayName,
      description:
        skill.shortDescription || skill.description || "启用这个 Skill",
      meta: skill.scope,
      icon: <FileCode2 size={15} />,
      selected,
      apply: () => {
        setSelectedSkillIds((current) =>
          current.includes(skill.id)
            ? current.filter((id) => id !== skill.id)
            : [...current, skill.id],
        );
      },
    });
  });

  return items;
}
