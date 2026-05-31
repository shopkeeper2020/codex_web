import {
  Archive,
  AtSign,
  Brain,
  Check,
  ChevronDown,
  FileCode2,
  FileText,
  Hand,
  Mic,
  Paperclip,
  Plus,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Settings,
  X,
} from "lucide-react";
import type {
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  ReactElement,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  attachmentContentUrl,
  getSkills,
  transcribeNativeDictation,
  uploadAttachment,
  type Attachment,
  type PermissionMode,
  type RuntimeCollaborationModeOption,
  type RuntimeOptions,
  type SkillOption,
} from "../../api";
import styles from "../App.module.css";

export type SendOptions = {
  model?: string;
  effort?: string;
  mode?: "start" | "steer";
  cwd?: string | null;
  skills?: Array<{ name: string; path: string }>;
  collaborationMode?: Record<string, unknown>;
  permissionMode?: PermissionMode;
};

type SlashMenuItem = {
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

const FALLBACK_RUNTIME_OPTIONS: RuntimeOptions = {
  models: [
    {
      id: "gpt-5.5",
      model: "gpt-5.5",
      displayName: "GPT-5.5",
      description: "Default Codex model fallback.",
      isDefault: true,
      defaultReasoningEffort: "xhigh",
      supportedReasoningEfforts: [
        { reasoningEffort: "medium", description: "Medium" },
        { reasoningEffort: "high", description: "High" },
        { reasoningEffort: "xhigh", description: "Extra high" },
      ],
      inputModalities: ["text", "image"],
    },
    {
      id: "gpt-5",
      model: "gpt-5",
      displayName: "GPT-5",
      description: "Compatible Codex model fallback.",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [
        { reasoningEffort: "medium", description: "Medium" },
        { reasoningEffort: "high", description: "High" },
        { reasoningEffort: "xhigh", description: "Extra high" },
      ],
      inputModalities: ["text", "image"],
    },
  ],
  collaborationModes: [
    {
      name: "Default",
      mode: "default",
      model: null,
      reasoningEffort: null,
      developerInstructions: null,
    },
    {
      name: "Plan",
      mode: "plan",
      model: null,
      reasoningEffort: null,
      developerInstructions: null,
    },
  ],
  defaults: {
    model: "gpt-5.5",
    reasoningEffort: "xhigh",
    collaborationModeName: "Default",
  },
  source: {
    models: "fallback",
    collaborationModes: "fallback",
  },
  warnings: [],
};

const FALLBACK_MODEL_OPTION = FALLBACK_RUNTIME_OPTIONS
  .models[0] as RuntimeOptions["models"][number];
const DICTATION_WAVEFORM_BARS = 42;
const PERMISSION_STORAGE_KEY = "codex_web.permissionMode";
const PERMISSION_OPTIONS: Array<{
  mode: PermissionMode;
  label: string;
  compactLabel: string;
  icon: typeof Hand;
}> = [
  {
    mode: "default",
    label: "默认权限",
    compactLabel: "默认权限",
    icon: Hand,
  },
  {
    mode: "auto-review",
    label: "自动审查",
    compactLabel: "自动审查",
    icon: ShieldCheck,
  },
  {
    mode: "full-access",
    label: "完全访问权限",
    compactLabel: "完全访问权限",
    icon: ShieldAlert,
  },
  {
    mode: "custom",
    label: "自定义 (config.toml)",
    compactLabel: "自定义",
    icon: Settings,
  },
];
const DEFAULT_PERMISSION_OPTION = PERMISSION_OPTIONS[2]!;

function readStoredPermissionMode(): PermissionMode {
  if (typeof window === "undefined") return "full-access";
  const stored = window.localStorage.getItem(PERMISSION_STORAGE_KEY);
  return PERMISSION_OPTIONS.some((option) => option.mode === stored)
    ? (stored as PermissionMode)
    : "full-access";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function compactModelLabel(option: RuntimeOptions["models"][number]): string {
  const raw = option.displayName || option.model;
  return (
    raw
      .replace(/^GPT-?/i, "")
      .replace(/^gpt-?/i, "")
      .trim() || raw
  );
}

function compactCollaborationModeLabel(
  option: RuntimeCollaborationModeOption,
): string {
  if (option.mode === "plan" || option.name.toLowerCase() === "plan")
    return "目标";
  return option.name.toLowerCase() === "default" ? "默认" : option.name;
}

function compactReasoningEffortLabel(effort: {
  reasoningEffort: string;
  description?: string | null;
}): string {
  if (effort.reasoningEffort === "xhigh") return "超高";
  if (effort.reasoningEffort === "high") return "高";
  if (effort.reasoningEffort === "medium") return "中";
  if (effort.reasoningEffort === "low") return "低";
  if (effort.reasoningEffort === "minimal") return "最小";
  return effort.description || effort.reasoningEffort;
}

function formatElapsedSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function buildCollaborationModePayload(
  option: RuntimeCollaborationModeOption,
  model: string,
  reasoningEffort: string,
): Record<string, unknown> | undefined {
  if (option.mode !== "plan") return undefined;
  return {
    mode: "plan",
    settings: {
      model: option.model ?? model,
      reasoning_effort: option.reasoningEffort ?? reasoningEffort,
      developer_instructions: option.developerInstructions ?? null,
    },
  };
}

export function Composer({
  threadId,
  cwd,
  activeTurnId,
  runtimeOptions,
  disabled,
  sending,
  onSend,
  onInterrupt,
  onCompactThread,
  formAriaLabel = "Composer",
  inputAriaLabel = "输入消息",
  sendAriaLabel = "发送",
}: {
  threadId: string;
  cwd: string | null;
  activeTurnId: string;
  runtimeOptions: RuntimeOptions | null;
  disabled: boolean;
  sending: boolean;
  onSend: (
    text: string,
    attachmentIds?: string[],
    options?: SendOptions,
  ) => Promise<void>;
  onInterrupt: () => Promise<void> | void;
  onCompactThread?: () => Promise<void> | void;
  formAriaLabel?: string;
  inputAriaLabel?: string;
  sendAriaLabel?: string;
}): ReactElement {
  const effectiveRuntimeOptions = runtimeOptions ?? FALLBACK_RUNTIME_OPTIONS;
  const modelOptions = effectiveRuntimeOptions.models.length
    ? effectiveRuntimeOptions.models
    : FALLBACK_RUNTIME_OPTIONS.models;
  const collaborationModeOptions = effectiveRuntimeOptions.collaborationModes
    .length
    ? effectiveRuntimeOptions.collaborationModes
    : FALLBACK_RUNTIME_OPTIONS.collaborationModes;
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [runtimeMenuOpen, setRuntimeMenuOpen] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dictationState, setDictationState] = useState<
    "idle" | "recording" | "transcribing"
  >("idle");
  const [dictationElapsedSeconds, setDictationElapsedSeconds] = useState(0);
  const [dictationLevels, setDictationLevels] = useState<number[]>(
    Array.from({ length: DICTATION_WAVEFORM_BARS }, () => 0.18),
  );
  const [model, setModel] = useState(effectiveRuntimeOptions.defaults.model);
  const [effort, setEffort] = useState(
    effectiveRuntimeOptions.defaults.reasoningEffort,
  );
  const [collaborationModeName, setCollaborationModeName] = useState<
    string | null
  >(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    readStoredPermissionMode,
  );
  const [sendMode, setSendMode] = useState<"steer" | "start">("start");
  const [sendModeTouched, setSendModeTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const actionControlRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashActiveItemRef = useRef<HTMLButtonElement | null>(null);
  const permissionControlRef = useRef<HTMLDivElement>(null);
  const runtimeControlRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const dictationStartedAtMsRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const waveformFrameRef = useRef<number | null>(null);
  const previousRuntimeDefaultsRef = useRef(effectiveRuntimeOptions.defaults);
  const uploadFocusRequestedRef = useRef(false);
  const focusRetryTimerRef = useRef<number | null>(null);
  const activeSteerMode = Boolean(activeTurnId) && sendMode === "steer";
  const selectedModel =
    modelOptions.find((option) => option.model === model) ??
    modelOptions[0] ??
    FALLBACK_MODEL_OPTION;
  const effortOptions = selectedModel.supportedReasoningEfforts.length
    ? selectedModel.supportedReasoningEfforts
    : FALLBACK_MODEL_OPTION.supportedReasoningEfforts;
  const selectedEffort = effortOptions.find(
    (option) => option.reasoningEffort === effort,
  ) ??
    effortOptions[0] ?? { reasoningEffort: effort, description: effort };
  const selectedCollaborationMode = collaborationModeName
    ? (collaborationModeOptions.find(
        (option) => option.name === collaborationModeName,
      ) ?? null)
    : null;
  const selectedPermission =
    PERMISSION_OPTIONS.find((option) => option.mode === permissionMode) ??
    DEFAULT_PERMISSION_OPTION;
  const SelectedPermissionIcon = selectedPermission.icon;
  const selectedSkillOptions = skills.filter((skill) =>
    selectedSkillIds.includes(skill.id),
  );
  const imageAttachments = attachments.filter((attachment) =>
    attachment.mimeType.startsWith("image/"),
  );
  const fileAttachments = attachments.filter(
    (attachment) => !attachment.mimeType.startsWith("image/"),
  );
  const hasSubmitContent = text.trim().length > 0 || attachments.length > 0;
  const controlsDisabled = disabled || sending || uploading;
  const dictationStatusText =
    dictationState === "transcribing" ? "正在转写..." : "";
  const hasAttachmentMeta =
    fileAttachments.length > 0 ||
    Boolean(uploadError) ||
    Boolean(dictationStatusText) ||
    Boolean(skillsError);
  const showAttachmentTray = imageAttachments.length > 0 || hasAttachmentMeta;
  const composerClassName = [
    styles.composer,
    dictationState === "recording" ? styles.composerRecording : "",
  ]
    .filter(Boolean)
    .join(" ");
  const composerPlaceholder =
    dictationState === "recording"
      ? "正在听写..."
      : dictationState === "transcribing"
        ? "正在转写..."
        : activeSteerMode
          ? "引导当前回复"
          : activeTurnId
            ? "排队下一条消息"
            : "要求后续变更";
  const stopActiveTurnMode =
    Boolean(activeTurnId) && !hasSubmitContent && !sending && !uploading;
  const slashQuery =
    slashMenuOpen && text.startsWith("/")
      ? text.slice(1).trim().toLowerCase()
      : "";
  const planCollaborationMode =
    collaborationModeOptions.find((option) => option.mode === "plan") ?? null;
  const slashMenuItems = useMemo<SlashMenuItem[]>(() => {
    const items: SlashMenuItem[] = [
      {
        id: "attachment:file",
        group: "功能",
        label: "添加照片和文件",
        description: "从此设备选择图片或文件",
        icon: <Paperclip size={15} />,
        closeOnApply: true,
        apply: () => {
          inputRef.current?.click();
        },
      },
    ];

    if (onCompactThread) {
      items.push({
        id: "thread:compact",
        group: "功能",
        label: "压缩",
        description: "压缩此会话的上下文",
        icon: <Archive size={15} />,
        closeOnApply: true,
        apply: () => {
          void onCompactThread();
        },
      });
    }

    if (activeTurnId) {
      items.push(
        {
          id: "send-mode:steer",
          group: "功能",
          label: "引导当前回复",
          description: "把下一条发送给正在运行的回复",
          icon: <AtSign size={15} />,
          selected: sendMode === "steer",
          apply: () => {
            setSendMode("steer");
            setSendModeTouched(true);
          },
        },
        {
          id: "send-mode:start",
          group: "功能",
          label: "排队下一条",
          description: "在当前回复后启动新的消息",
          icon: <AtSign size={15} />,
          selected: sendMode === "start",
          apply: () => {
            setSendMode("start");
            setSendModeTouched(true);
          },
        },
      );
    }

    if (planCollaborationMode) {
      items.push({
        id: "collaboration:plan",
        group: "功能",
        label: "目标",
        description: "设置 Codex 将持续努力实现的目标",
        icon: <Brain size={15} />,
        selected: collaborationModeName === planCollaborationMode.name,
        disabled: activeSteerMode,
        apply: () => {
          setCollaborationModeName(planCollaborationMode.name);
        },
      });
    }

    items.push({
      id: "collaboration:default",
      group: "功能",
      label: "默认模式",
      description: "回到普通跟进，不附加目标模式",
      icon: <Sparkles size={15} />,
      selected: collaborationModeName === null,
      apply: () => {
        setCollaborationModeName(null);
      },
    });

    PERMISSION_OPTIONS.forEach((option) => {
      const OptionIcon = option.icon;
      items.push({
        id: `permission:${option.mode}`,
        group: "功能",
        label: option.label,
        description: "切换本次消息的权限模式",
        icon: <OptionIcon size={15} />,
        selected: permissionMode === option.mode,
        apply: () => {
          setPermissionMode(option.mode);
        },
      });
    });

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
  }, [
    activeSteerMode,
    activeTurnId,
    collaborationModeName,
    onCompactThread,
    permissionMode,
    planCollaborationMode,
    selectedSkillIds,
    sendMode,
    skills,
  ]);
  const filteredSlashMenuItems = useMemo(() => {
    if (!slashQuery) return slashMenuItems;
    return slashMenuItems.filter((item) =>
      [item.group, item.label, item.description, item.meta ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(slashQuery),
    );
  }, [slashMenuItems, slashQuery]);
  const activeSlashItem =
    filteredSlashMenuItems[
      Math.min(slashActiveIndex, Math.max(0, filteredSlashMenuItems.length - 1))
    ] ?? null;

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  useEffect(() => {
    if (!activeTurnId) {
      setSendMode("start");
      setSendModeTouched(false);
      return;
    }
    if (!sendModeTouched) setSendMode("steer");
  }, [activeTurnId, sendModeTouched]);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashQuery, slashMenuItems.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashActiveItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [slashActiveIndex, filteredSlashMenuItems.length, slashMenuOpen]);

  useEffect(() => {
    if (controlsDisabled || dictationState !== "idle") setSlashMenuOpen(false);
  }, [controlsDisabled, dictationState]);

  useEffect(() => {
    let disposed = false;
    setSkillsLoading(true);
    setSkillsError("");
    getSkills({ cwd })
      .then((result) => {
        if (disposed) return;
        const enabledSkills = result.skills.filter((skill) => skill.enabled);
        setSkills(enabledSkills);
        setSelectedSkillIds((current) =>
          current.filter((id) =>
            enabledSkills.some((skill) => skill.id === id),
          ),
        );
        setSkillsError(result.warnings[0] ?? result.errors[0]?.message ?? "");
      })
      .catch((unknownError) => {
        if (!disposed)
          setSkillsError(
            unknownError instanceof Error
              ? unknownError.message
              : "skills list failed",
          );
      })
      .finally(() => {
        if (!disposed) setSkillsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [cwd]);

  useEffect(() => {
    setAttachments([]);
    setSelectedSkillIds([]);
    setSkillsOpen(false);
    setActionMenuOpen(false);
    setSlashMenuOpen(false);
    setPermissionMenuOpen(false);
    setRuntimeMenuOpen(false);
    setSendModeTouched(false);
  }, [threadId]);

  useEffect(() => {
    if (!runtimeOptions) return;
    const previousDefaults = previousRuntimeDefaultsRef.current;
    const nextDefaults = runtimeOptions.defaults;
    setModel((current) =>
      current === previousDefaults.model ? nextDefaults.model : current,
    );
    setEffort((current) =>
      current === previousDefaults.reasoningEffort
        ? nextDefaults.reasoningEffort
        : current,
    );
    previousRuntimeDefaultsRef.current = nextDefaults;
  }, [runtimeOptions]);

  useEffect(() => {
    if (
      !actionMenuOpen &&
      !slashMenuOpen &&
      !permissionMenuOpen &&
      !runtimeMenuOpen
    )
      return;

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        actionControlRef.current?.contains(target) ||
        slashMenuRef.current?.contains(target) ||
        textareaRef.current?.contains(target) ||
        permissionControlRef.current?.contains(target) ||
        runtimeControlRef.current?.contains(target)
      )
        return;
      setActionMenuOpen(false);
      setSlashMenuOpen(false);
      setPermissionMenuOpen(false);
      setRuntimeMenuOpen(false);
      setSkillsOpen(false);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setActionMenuOpen(false);
      setSlashMenuOpen(false);
      setPermissionMenuOpen(false);
      setRuntimeMenuOpen(false);
      setSkillsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionMenuOpen, permissionMenuOpen, runtimeMenuOpen, slashMenuOpen]);

  useEffect(() => {
    window.localStorage.setItem(PERMISSION_STORAGE_KEY, permissionMode);
  }, [permissionMode]);

  useEffect(() => {
    return () => {
      stopDictationStream();
      if (focusRetryTimerRef.current !== null) {
        window.clearTimeout(focusRetryTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!uploadFocusRequestedRef.current || controlsDisabled) return;
    scheduleFocusTextareaEnd();
  }, [attachments.length, controlsDisabled]);

  useEffect(() => {
    if (!uploadFocusRequestedRef.current || uploading || controlsDisabled) {
      return;
    }
    scheduleFocusTextareaEnd();
  }, [controlsDisabled, uploading]);

  useEffect(() => {
    if (dictationState !== "recording") return undefined;
    const updateElapsed = (): void => {
      setDictationElapsedSeconds(
        Math.floor((Date.now() - dictationStartedAtMsRef.current) / 1000),
      );
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(interval);
  }, [dictationState]);

  useEffect(() => {
    if (!modelOptions.some((option) => option.model === model)) {
      setModel(effectiveRuntimeOptions.defaults.model);
    }
  }, [effectiveRuntimeOptions.defaults.model, model, modelOptions]);

  useEffect(() => {
    if (!effortOptions.some((option) => option.reasoningEffort === effort)) {
      setEffort(
        selectedModel.defaultReasoningEffort ||
          effortOptions[0]?.reasoningEffort ||
          "xhigh",
      );
    }
  }, [effort, effortOptions, selectedModel.defaultReasoningEffort]);

  useEffect(() => {
    if (
      collaborationModeName &&
      !collaborationModeOptions.some(
        (option) => option.name === collaborationModeName,
      )
    ) {
      setCollaborationModeName(null);
    }
  }, [collaborationModeName, collaborationModeOptions]);

  async function uploadFiles(files: FileList | File[]): Promise<void> {
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0 || disabled) return;
    const attachmentThreadId = threadId.startsWith("draft:")
      ? null
      : threadId || null;
    setUploading(true);
    setUploadError("");
    try {
      const uploaded: Attachment[] = [];
      for (const file of selectedFiles) {
        uploaded.push(
          await uploadAttachment({ file, threadId: attachmentThreadId }),
        );
      }
      setAttachments((current) => [...current, ...uploaded]);
    } catch (unknownError) {
      setUploadError(
        unknownError instanceof Error ? unknownError.message : "upload failed",
      );
    } finally {
      uploadFocusRequestedRef.current = true;
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      scheduleFocusTextareaEnd();
    }
  }

  function focusTextareaEnd(): boolean {
    const textarea = textareaRef.current;
    if (!textarea || textarea.disabled) return false;
    textarea.focus({ preventScroll: true });
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
    return document.activeElement === textarea;
  }

  function scheduleFocusTextareaEnd(): void {
    if (focusRetryTimerRef.current !== null) {
      window.clearTimeout(focusRetryTimerRef.current);
      focusRetryTimerRef.current = null;
    }
    let attempts = 0;
    const attemptFocus = (): void => {
      attempts += 1;
      if (focusTextareaEnd()) {
        uploadFocusRequestedRef.current = false;
        focusRetryTimerRef.current = null;
        return;
      }
      if (attempts >= 10) {
        focusRetryTimerRef.current = null;
        return;
      }
      focusRetryTimerRef.current = window.setTimeout(
        attemptFocus,
        attempts < 3 ? 16 : 50,
      );
    };
    focusRetryTimerRef.current = window.setTimeout(attemptFocus, 0);
  }

  function clearSlashTriggerText(): void {
    setText((current) => (current.startsWith("/") ? "" : current));
    scheduleFocusTextareaEnd();
  }

  function applySlashMenuItem(item: SlashMenuItem | null): void {
    if (!item || item.disabled || controlsDisabled) return;
    item.apply();
    clearSlashTriggerText();
    setActionMenuOpen(false);
    setPermissionMenuOpen(false);
    setRuntimeMenuOpen(false);
    setSkillsOpen(false);
    setSlashMenuOpen(!item.closeOnApply);
  }

  function handleComposerTextChange(nextText: string): void {
    setText(nextText);
    const canOpenSlashMenu =
      nextText.startsWith("/") &&
      !nextText.includes("\n") &&
      !controlsDisabled &&
      dictationState === "idle";
    if (canOpenSlashMenu) {
      setSlashMenuOpen(true);
      setActionMenuOpen(false);
      setPermissionMenuOpen(false);
      setRuntimeMenuOpen(false);
      setSkillsOpen(false);
    } else if (!nextText.startsWith("/")) {
      setSlashMenuOpen(false);
    }
  }

  function insertDictationText(transcript: string): void {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) return;
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? text.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    setText((current) => {
      const start = Math.min(selectionStart, current.length);
      const end = Math.min(selectionEnd, current.length);
      const prefix = current.slice(0, start);
      const suffix = current.slice(end);
      const needsLeadingSpace =
        prefix.length > 0 && !/[\s([{（【]$/u.test(prefix);
      const needsTrailingSpace =
        suffix.length > 0 && !/^[\s.,!?;:，。！？；：)\]}）】]/u.test(suffix);
      const inserted = `${needsLeadingSpace ? " " : ""}${cleanTranscript}${needsTrailingSpace ? " " : ""}`;
      const next = `${prefix}${inserted}${suffix}`;
      const cursor = prefix.length + inserted.length;
      window.setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(cursor, cursor);
      }, 0);
      return next;
    });
  }

  function stopDictationStream(): void {
    if (waveformFrameRef.current !== null) {
      window.cancelAnimationFrame(waveformFrameRef.current);
      waveformFrameRef.current = null;
    }
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function startDictationWaveform(stream: MediaStream): void {
    const AudioContextCtor =
      window.AudioContext ||
      (
        window as Window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    audioContextRef.current = audioContext;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let lastPaintAt = 0;

    const tick = (): void => {
      analyser.getByteTimeDomainData(data);
      const now = performance.now();
      if (now - lastPaintAt < 70) {
        waveformFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }
      lastPaintAt = now;
      const bars = Array.from(
        { length: DICTATION_WAVEFORM_BARS },
        (_, index) => {
          const sliceStart = Math.floor(
            (index / DICTATION_WAVEFORM_BARS) * data.length,
          );
          const sliceEnd = Math.max(
            sliceStart + 1,
            Math.floor(((index + 1) / DICTATION_WAVEFORM_BARS) * data.length),
          );
          let total = 0;
          for (let cursor = sliceStart; cursor < sliceEnd; cursor += 1) {
            total += Math.abs((data[cursor] ?? 128) - 128) / 128;
          }
          const average = total / (sliceEnd - sliceStart);
          return Math.min(1, Math.max(0.16, average * 4.8));
        },
      );
      setDictationLevels(bars);
      waveformFrameRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  }

  async function handleNativeDictation(): Promise<void> {
    if (disabled || sending || uploading || dictationState === "transcribing")
      return;
    if (dictationState === "recording") {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      return;
    }
    setUploadError("");
    setActionMenuOpen(false);
    setSlashMenuOpen(false);
    setRuntimeMenuOpen(false);
    focusTextareaEnd();
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error("当前浏览器不支持录音 API。");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
      });
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];
      setDictationElapsedSeconds(0);
      setDictationLevels(
        Array.from({ length: DICTATION_WAVEFORM_BARS }, () => 0.18),
      );
      startDictationWaveform(stream);
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setUploadError("原生语音输入录音失败。");
        setDictationState("idle");
        stopDictationStream();
      };
      recorder.onstop = () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        stopDictationStream();
        void (async () => {
          setDictationState("transcribing");
          try {
            const elapsedMs = Date.now() - dictationStartedAtMsRef.current;
            const audio = new Blob(chunks, {
              type: recorder.mimeType || chunks[0]?.type || "audio/webm",
            });
            if (audio.size === 0) throw new Error("没有录到音频。");
            if (elapsedMs < 250) throw new Error("听写时间太短，请再试一次。");
            const transcript = await transcribeNativeDictation({
              audio,
              filename: `codex.${audio.type.split(/[;/]/)[0]?.split("/")[1] || "webm"}`,
            });
            insertDictationText(transcript);
          } catch (unknownError) {
            setUploadError(
              unknownError instanceof Error
                ? unknownError.message
                : "native transcription failed",
            );
          } finally {
            setDictationState("idle");
            mediaRecorderRef.current = null;
          }
        })();
      };
      recorder.start();
      dictationStartedAtMsRef.current = Date.now();
      setDictationState("recording");
    } catch (unknownError) {
      stopDictationStream();
      mediaRecorderRef.current = null;
      setDictationState("idle");
      setUploadError(
        unknownError instanceof Error
          ? unknownError.message
          : "native dictation failed",
      );
    }
  }

  function handleDrop(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (event.dataTransfer.files.length > 0)
      void uploadFiles(event.dataTransfer.files);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const pastedFiles = Array.from(event.clipboardData.files);
    const files = pastedFiles.length
      ? pastedFiles
      : Array.from(event.clipboardData.items)
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file));
    if (files.length === 0) return;
    event.preventDefault();
    uploadFocusRequestedRef.current = true;
    void uploadFiles(files);
  }

  function handleTextareaKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (slashMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashActiveIndex((current) =>
          filteredSlashMenuItems.length === 0
            ? 0
            : (current + 1) % filteredSlashMenuItems.length,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashActiveIndex((current) =>
          filteredSlashMenuItems.length === 0
            ? 0
            : (current - 1 + filteredSlashMenuItems.length) %
              filteredSlashMenuItems.length,
        );
        return;
      }
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        applySlashMenuItem(activeSlashItem);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
    }
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    void submitCurrentMessage();
  }

  async function submitCurrentMessage(): Promise<void> {
    const trimmed = text.trim();
    if (slashMenuOpen && trimmed.startsWith("/")) return;
    if (
      (!trimmed && attachments.length === 0) ||
      disabled ||
      sending ||
      uploading
    )
      return;
    const collaborationMode = selectedCollaborationMode
      ? buildCollaborationModePayload(selectedCollaborationMode, model, effort)
      : undefined;
    const selectedSkills = selectedSkillOptions.map((skill) => ({
      name: skill.name,
      path: skill.path,
    }));
    await onSend(
      trimmed,
      attachments.map((attachment) => attachment.id),
      {
        model,
        effort,
        mode: activeSteerMode ? "steer" : "start",
        cwd,
        skills: selectedSkills,
        collaborationMode: activeSteerMode ? undefined : collaborationMode,
        permissionMode,
      },
    );
    setText("");
    setSelectedSkillIds([]);
    setAttachments([]);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    await submitCurrentMessage();
  }

  async function handleInterrupt(): Promise<void> {
    if (!activeTurnId || disabled || sending || uploading) return;
    await onInterrupt();
  }

  return (
    <div className={styles.composerDock}>
      <form
        className={composerClassName}
        aria-label={formAriaLabel}
        onSubmit={(event) => void handleSubmit(event)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          className={styles.hiddenFileInput}
          type="file"
          multiple
          onChange={(event) => {
            if (event.target.files) void uploadFiles(event.target.files);
          }}
        />
        {showAttachmentTray ? (
          <div className={styles.attachmentTray} aria-label="附件托盘">
            {imageAttachments.length ? (
              <div
                className={styles.attachmentImageGrid}
                data-testid="composer-image-attachments"
              >
                {imageAttachments.map((attachment) => (
                  <span
                    className={styles.attachmentImageChip}
                    key={attachment.id}
                  >
                    <img
                      src={attachmentContentUrl(attachment.id)}
                      alt={attachment.filename}
                    />
                    <button
                      type="button"
                      aria-label={`移除 ${attachment.filename}`}
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {hasAttachmentMeta ? (
              <div
                className={styles.attachmentMetaRow}
                data-testid="composer-file-attachments"
              >
                {fileAttachments.map((attachment) => (
                  <span
                    className={styles.attachmentFileCard}
                    key={attachment.id}
                  >
                    <span className={styles.attachmentFileIcon}>
                      <FileText size={15} />
                    </span>
                    <a
                      href={attachmentContentUrl(attachment.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {attachment.filename}
                    </a>
                    <small>{formatBytes(attachment.size)}</small>
                    <button
                      type="button"
                      aria-label={`移除 ${attachment.filename}`}
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
                {uploadError ? (
                  <span className={styles.attachmentError}>{uploadError}</span>
                ) : null}
                {dictationStatusText ? (
                  <span className={styles.attachmentChip}>
                    <Mic size={13} />
                    <span>{dictationStatusText}</span>
                  </span>
                ) : null}
                {skillsError ? (
                  <span className={styles.attachmentError}>{skillsError}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {slashMenuOpen ? (
          <div
            className={styles.slashCommandMenu}
            ref={slashMenuRef}
            role="menu"
            aria-label="斜杠菜单"
          >
            {filteredSlashMenuItems.length === 0 ? (
              <div className={styles.slashCommandMenuEmpty}>没有匹配项</div>
            ) : (
              filteredSlashMenuItems.map((item, index) => {
                const previous = filteredSlashMenuItems[index - 1];
                const showGroup = !previous || previous.group !== item.group;
                const active = item === activeSlashItem;
                return (
                  <div className={styles.slashCommandMenuRow} key={item.id}>
                    {showGroup ? (
                      <div className={styles.slashCommandMenuGroup}>
                        {item.group}
                      </div>
                    ) : null}
                    <button
                      ref={active ? slashActiveItemRef : undefined}
                      className={[
                        styles.slashCommandMenuItem,
                        active ? styles.slashCommandMenuItemActive : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      type="button"
                      role={
                        item.selected === undefined
                          ? "menuitem"
                          : "menuitemcheckbox"
                      }
                      aria-checked={
                        item.selected === undefined ? undefined : item.selected
                      }
                      data-active={active ? "true" : undefined}
                      disabled={item.disabled}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySlashMenuItem(item)}
                    >
                      <span className={styles.slashCommandIcon}>
                        {item.icon}
                      </span>
                      <span className={styles.slashCommandCopy}>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      {item.meta ? (
                        <span className={styles.slashCommandMeta}>
                          {item.meta}
                        </span>
                      ) : null}
                      {item.selected ? <Check size={14} /> : null}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        ) : null}
        <div className={styles.composerPromptLine}>
          {selectedSkillOptions.length ? (
            <span
              className={styles.composerInlineSkills}
              data-testid="composer-inline-skills"
            >
              {selectedSkillOptions.map((skill) => (
                <span className={styles.composerInlineSkillChip} key={skill.id}>
                  <Sparkles size={13} />
                  <span>{skill.displayName}</span>
                  <small>{skill.scope}</small>
                  <button
                    type="button"
                    aria-label={`移除 ${skill.displayName}`}
                    onClick={() =>
                      setSelectedSkillIds((current) =>
                        current.filter((id) => id !== skill.id),
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </span>
          ) : null}
          <textarea
            ref={textareaRef}
            placeholder={composerPlaceholder}
            rows={2}
            aria-label={inputAriaLabel}
            disabled={controlsDisabled}
            value={text}
            onChange={(event) => handleComposerTextChange(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
            onPaste={handlePaste}
          />
        </div>
        <div className={styles.composerControls}>
          {dictationState === "recording" ? (
            <div
              className={styles.dictationControls}
              role="group"
              aria-label="听写控制"
            >
              <button
                className={styles.composerRoundButton}
                type="button"
                aria-label="输入选项"
                disabled
              >
                <Plus size={18} />
              </button>
              <div
                className={styles.dictationWaveform}
                role="img"
                aria-label="听写波形"
              >
                {dictationLevels.map((level, index) => (
                  <span
                    className={styles.dictationWaveformBar}
                    key={index}
                    style={{ height: `${Math.round(5 + level * 24)}px` }}
                  />
                ))}
              </div>
              <span className={styles.dictationElapsed}>
                {formatElapsedSeconds(dictationElapsedSeconds)}
              </span>
              <button
                className={styles.dictationStopButton}
                type="button"
                aria-label="停止听写"
                title="停止听写"
                onClick={() => void handleNativeDictation()}
              >
                <Square size={9} fill="currentColor" />
              </button>
              <button
                className={styles.sendButton}
                type="submit"
                aria-label={sendAriaLabel}
                disabled={disabled || sending || uploading || !hasSubmitContent}
              >
                <SendHorizontal size={18} />
              </button>
            </div>
          ) : (
            <>
              <div
                className={styles.composerActionControl}
                ref={actionControlRef}
              >
                <button
                  className={styles.composerRoundButton}
                  type="button"
                  aria-label="打开输入选项"
                  aria-expanded={actionMenuOpen}
                  disabled={controlsDisabled}
                  onClick={() => {
                    setActionMenuOpen((open) => !open);
                    setSlashMenuOpen(false);
                    setPermissionMenuOpen(false);
                    setRuntimeMenuOpen(false);
                  }}
                >
                  <Plus size={18} />
                </button>
                {actionMenuOpen ? (
                  <div
                    className={styles.composerActionMenu}
                    role="menu"
                    aria-label="输入选项"
                  >
                    <button
                      className={styles.composerActionMenuItem}
                      type="button"
                      role="menuitem"
                      disabled={controlsDisabled || uploading}
                      onClick={() => {
                        setActionMenuOpen(false);
                        inputRef.current?.click();
                      }}
                    >
                      <Paperclip size={15} />
                      <span>添加照片和文件</span>
                    </button>
                    {activeTurnId ? (
                      <>
                        <div className={styles.composerActionMenuDivider} />
                        <button
                          className={styles.composerActionMenuItem}
                          type="button"
                          role="menuitemradio"
                          aria-checked={sendMode === "steer"}
                          onClick={() => {
                            setSendMode("steer");
                            setSendModeTouched(true);
                          }}
                        >
                          <AtSign size={15} />
                          <span>引导当前回复</span>
                          {sendMode === "steer" ? <Check size={14} /> : null}
                        </button>
                        <button
                          className={styles.composerActionMenuItem}
                          type="button"
                          role="menuitemradio"
                          aria-checked={sendMode === "start"}
                          onClick={() => {
                            setSendMode("start");
                            setSendModeTouched(true);
                          }}
                        >
                          <AtSign size={15} />
                          <span>排队下一条</span>
                          {sendMode === "start" ? <Check size={14} /> : null}
                        </button>
                      </>
                    ) : null}
                    <div className={styles.composerActionMenuDivider} />
                    {collaborationModeOptions.map((option) => {
                      const isDefaultMode = option.mode === "default";
                      const checked = isDefaultMode
                        ? collaborationModeName === null
                        : option.name === collaborationModeName;
                      return (
                        <button
                          className={styles.composerActionMenuItem}
                          type="button"
                          role="menuitemradio"
                          aria-checked={checked}
                          disabled={activeSteerMode}
                          key={`${option.mode}:${option.name}`}
                          onClick={() => {
                            setCollaborationModeName(
                              isDefaultMode ? null : option.name,
                            );
                            setActionMenuOpen(false);
                          }}
                        >
                          <Brain size={15} />
                          <span>{compactCollaborationModeLabel(option)}</span>
                          {checked ? <Check size={14} /> : null}
                        </button>
                      );
                    })}
                    <div className={styles.composerActionMenuDivider} />
                    <button
                      className={styles.composerActionMenuItem}
                      type="button"
                      aria-expanded={skillsOpen}
                      onClick={() => setSkillsOpen((open) => !open)}
                    >
                      <FileCode2 size={15} />
                      <span>插件</span>
                      <ChevronDown size={14} />
                    </button>
                    {skillsOpen ? (
                      <div className={styles.composerActionSkills}>
                        {skillsLoading ? (
                          <div className={styles.skillsEmpty}>正在读取...</div>
                        ) : null}
                        {!skillsLoading && skills.length === 0 ? (
                          <div className={styles.skillsEmpty}>
                            没有可用 Skills
                          </div>
                        ) : null}
                        {!skillsLoading
                          ? skills.map((skill) => (
                              <label
                                className={styles.skillOption}
                                key={skill.id}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedSkillIds.includes(skill.id)}
                                  onChange={(event) => {
                                    setSelectedSkillIds((current) =>
                                      event.target.checked
                                        ? [...current, skill.id]
                                        : current.filter(
                                            (id) => id !== skill.id,
                                          ),
                                    );
                                  }}
                                />
                                <span>
                                  <strong>{skill.displayName}</strong>
                                  <small>
                                    {skill.shortDescription ||
                                      skill.description ||
                                      skill.scope}
                                  </small>
                                </span>
                              </label>
                            ))
                          : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div
                className={styles.permissionControlWrap}
                ref={permissionControlRef}
              >
                <button
                  className={styles.permissionControl}
                  type="button"
                  aria-label="权限设置"
                  aria-expanded={permissionMenuOpen}
                  disabled={controlsDisabled}
                  onClick={() => {
                    setPermissionMenuOpen((open) => !open);
                    setActionMenuOpen(false);
                    setSlashMenuOpen(false);
                    setRuntimeMenuOpen(false);
                    setSkillsOpen(false);
                  }}
                >
                  <SelectedPermissionIcon size={15} />
                  <span>{selectedPermission.compactLabel}</span>
                  <ChevronDown size={13} />
                </button>
                {permissionMenuOpen ? (
                  <div
                    className={styles.permissionMenu}
                    role="menu"
                    aria-label="权限设置"
                  >
                    {PERMISSION_OPTIONS.map((option) => {
                      const OptionIcon = option.icon;
                      return (
                        <button
                          className={styles.permissionMenuItem}
                          type="button"
                          role="menuitemradio"
                          aria-checked={option.mode === permissionMode}
                          key={option.mode}
                          onClick={() => {
                            setPermissionMode(option.mode);
                            setPermissionMenuOpen(false);
                          }}
                        >
                          <OptionIcon size={15} />
                          <span>{option.label}</span>
                          {option.mode === permissionMode ? (
                            <Check size={14} />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              {activeTurnId ? (
                <button
                  className={[styles.controlButton, styles.targetSelect].join(
                    " ",
                  )}
                  type="button"
                  aria-label="发送目标"
                  disabled={controlsDisabled}
                  title={activeSteerMode ? "引导当前回复" : "排队下一条"}
                  onClick={() => {
                    setSendMode(activeSteerMode ? "start" : "steer");
                    setSendModeTouched(true);
                  }}
                >
                  <AtSign size={15} />
                  <span>{activeSteerMode ? "当前" : "排队"}</span>
                  <ChevronDown size={13} />
                </button>
              ) : null}
              {selectedCollaborationMode && !activeSteerMode ? (
                <button
                  className={[styles.controlButton, styles.modeSelect].join(
                    " ",
                  )}
                  type="button"
                  aria-label="协作模式"
                  disabled={controlsDisabled}
                  onClick={() => {
                    setActionMenuOpen(true);
                    setSlashMenuOpen(false);
                    setPermissionMenuOpen(false);
                    setRuntimeMenuOpen(false);
                  }}
                >
                  <Brain size={15} />
                  <span>
                    {compactCollaborationModeLabel(selectedCollaborationMode)}
                  </span>
                  <ChevronDown size={13} />
                </button>
              ) : null}
              {selectedSkillIds.length ? (
                <button
                  className={styles.controlButton}
                  type="button"
                  disabled={controlsDisabled}
                  aria-label="打开 Skills"
                  onClick={() => {
                    setActionMenuOpen(true);
                    setSkillsOpen(true);
                    setSlashMenuOpen(false);
                    setPermissionMenuOpen(false);
                    setRuntimeMenuOpen(false);
                  }}
                >
                  <FileCode2 size={15} />
                  <span className={styles.controlCount}>
                    {selectedSkillIds.length}
                  </span>
                </button>
              ) : null}
              <span className={styles.controlSpacer} aria-hidden="true" />
              <div className={styles.runtimeControl} ref={runtimeControlRef}>
                <button
                  className={styles.runtimeButton}
                  type="button"
                  aria-label="模型与思考深度"
                  aria-expanded={runtimeMenuOpen}
                  disabled={controlsDisabled}
                  onClick={() => {
                    setRuntimeMenuOpen((open) => !open);
                    setActionMenuOpen(false);
                    setSlashMenuOpen(false);
                    setPermissionMenuOpen(false);
                  }}
                >
                  <span>{compactModelLabel(selectedModel)}</span>
                  <span>{compactReasoningEffortLabel(selectedEffort)}</span>
                  <ChevronDown size={13} />
                </button>
                {runtimeMenuOpen ? (
                  <div
                    className={styles.runtimeMenu}
                    role="menu"
                    aria-label="模型与思考深度"
                  >
                    <div className={styles.runtimeMenuSection}>智能</div>
                    {effortOptions.map((option) => (
                      <button
                        className={[
                          styles.runtimeMenuItem,
                          option.reasoningEffort === effort
                            ? styles.runtimeMenuItemActive
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.reasoningEffort === effort}
                        key={option.reasoningEffort}
                        onClick={() => {
                          setEffort(option.reasoningEffort);
                          setRuntimeMenuOpen(false);
                        }}
                      >
                        <span>{compactReasoningEffortLabel(option)}</span>
                        {option.reasoningEffort === effort ? (
                          <Check size={14} />
                        ) : null}
                      </button>
                    ))}
                    <div className={styles.runtimeMenuSection}>模型</div>
                    {modelOptions.map((option) => (
                      <button
                        className={[
                          styles.runtimeMenuItem,
                          option.model === model
                            ? styles.runtimeMenuItemActive
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.model === model}
                        key={option.id}
                        onClick={() => {
                          setModel(option.model);
                          setRuntimeMenuOpen(false);
                        }}
                      >
                        <span>{option.displayName || option.model}</span>
                        {option.model === model ? <Check size={14} /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                className={styles.composerRoundButton}
                type="button"
                aria-label="原生语音输入"
                title="原生语音输入"
                disabled={
                  disabled ||
                  sending ||
                  uploading ||
                  dictationState === "transcribing"
                }
                onClick={() => void handleNativeDictation()}
              >
                <Mic size={17} />
              </button>
              <button
                className={styles.sendButton}
                type={stopActiveTurnMode ? "button" : "submit"}
                aria-label={
                  stopActiveTurnMode ? "停止当前回复" : sendAriaLabel
                }
                disabled={
                  disabled ||
                  sending ||
                  uploading ||
                  (!stopActiveTurnMode && !hasSubmitContent)
                }
                onClick={
                  stopActiveTurnMode
                    ? () => {
                        void handleInterrupt();
                      }
                    : undefined
                }
              >
                {stopActiveTurnMode ? (
                  <Square size={15} fill="currentColor" />
                ) : (
                  <SendHorizontal size={18} />
                )}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
