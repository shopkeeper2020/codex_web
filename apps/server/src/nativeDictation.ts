import { execFile as execFileCallback } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { NativeDictationStatus } from "@codex-web/api";

const execFile = promisify(execFileCallback);

const KEYBINDINGS_FILENAME = "keybindings.json";
const ENV_HOTKEY = "CODEX_WEB_NATIVE_DICTATION_HOTKEY";
const GLOBAL_DICTATION_TOGGLE_COMMAND = "globalDictationToggle";
const GLOBAL_DICTATION_HOLD_COMMAND = "globalDictationHold";

type ExecFileLike = (
  file: string,
  args: string[],
  options: { windowsHide: boolean },
) => Promise<unknown>;

type NativeDictationStatusOptions = {
  codexHome?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

type TriggerNativeDictationOptions = NativeDictationStatusOptions & {
  execFile?: ExecFileLike;
};

type KeybindingEntry = {
  command?: unknown;
  key?: unknown;
};

export class NativeDictationError extends Error {
  readonly statusCode: number;
  readonly status: NativeDictationStatus;

  constructor(message: string, status: NativeDictationStatus, statusCode = 409) {
    super(message);
    this.name = "NativeDictationError";
    this.status = status;
    this.statusCode = statusCode;
  }
}

export function getNativeDictationStatus(
  options: NativeDictationStatusOptions = {},
): NativeDictationStatus {
  const platform = options.platform ?? process.platform;
  const supported = platform === "win32";
  const configured = readConfiguredHotkey(options);
  if (!supported) {
    return {
      supported: false,
      configured: Boolean(configured.hotkey),
      hotkey: configured.hotkey,
      commandId: configured.commandId,
      source: configured.source,
      warning: "Native Codex dictation hotkey bridge is currently implemented for Windows only.",
    };
  }
  if (!configured.hotkey) {
    return {
      supported: true,
      configured: false,
      hotkey: null,
      commandId: null,
      source: "none",
      warning:
        "Codex Desktop has no Global Dictation Toggle hotkey configured. Configure it in Desktop keyboard shortcuts or set CODEX_WEB_NATIVE_DICTATION_HOTKEY.",
    };
  }
  if (configured.commandId === GLOBAL_DICTATION_HOLD_COMMAND) {
    return {
      supported: true,
      configured: true,
      hotkey: configured.hotkey,
      commandId: configured.commandId,
      source: configured.source,
      warning:
        "Only a hold-to-talk global dictation hotkey was found. A toggle hotkey is recommended for Web because a synthetic key tap cannot keep the key held.",
    };
  }
  return {
    supported: true,
    configured: true,
    hotkey: configured.hotkey,
    commandId: configured.commandId,
    source: configured.source,
    warning: null,
  };
}

export async function triggerNativeDictation(
  options: TriggerNativeDictationOptions = {},
): Promise<NativeDictationStatus & { ok: boolean }> {
  const status = getNativeDictationStatus(options);
  if (!status.supported || !status.configured || !status.hotkey) {
    throw new NativeDictationError(status.warning ?? "Native dictation is not configured.", status);
  }
  const sequence = acceleratorToWindowsSendKeys(status.hotkey);
  const command = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    `[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellSingleQuoted(sequence)}')`,
  ].join(" ");
  const execFileImpl =
    options.execFile ??
    (async (file, args, execOptions) => {
      await execFile(file, args, execOptions);
    });
  await execFileImpl(
    "powershell.exe",
    [
      "-STA",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ],
    { windowsHide: true },
  );
  return {
    ...status,
    ok: true,
  };
}

export function acceleratorToWindowsSendKeys(accelerator: string): string {
  const parts = accelerator
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers = new Set<string>();
  const keys: string[] = [];
  for (const part of parts) {
    const normalized = normalizeModifier(part);
    if (normalized) {
      modifiers.add(normalized);
      continue;
    }
    keys.push(part);
  }
  if (keys.length !== 1) {
    throw new Error(`Unsupported dictation hotkey: ${accelerator}`);
  }
  const key = keys[0];
  if (!key) throw new Error(`Unsupported dictation hotkey: ${accelerator}`);
  return `${modifiers.has("control") ? "^" : ""}${modifiers.has("alt") ? "%" : ""}${modifiers.has("shift") ? "+" : ""}${formatSendKey(key)}`;
}

function readConfiguredHotkey(
  options: NativeDictationStatusOptions,
): Pick<NativeDictationStatus, "hotkey" | "commandId" | "source"> {
  const envHotkey = options.env?.[ENV_HOTKEY] ?? process.env[ENV_HOTKEY];
  if (envHotkey?.trim()) {
    return {
      hotkey: envHotkey.trim(),
      commandId: GLOBAL_DICTATION_TOGGLE_COMMAND,
      source: "environment",
    };
  }
  const codexHome = options.codexHome ?? join(homedir(), ".codex");
  const keybindingsPath = join(codexHome, KEYBINDINGS_FILENAME);
  if (!existsSync(keybindingsPath)) {
    return {
      hotkey: null,
      commandId: null,
      source: "none",
    };
  }
  try {
    const entries = JSON.parse(readFileSync(keybindingsPath, "utf8")) as unknown;
    const bindings = Array.isArray(entries) ? entries : [];
    const toggleHotkey = findCommandHotkey(
      bindings,
      GLOBAL_DICTATION_TOGGLE_COMMAND,
    );
    if (toggleHotkey) {
      return {
        hotkey: toggleHotkey,
        commandId: GLOBAL_DICTATION_TOGGLE_COMMAND,
        source: "codex-keybindings",
      };
    }
    const holdHotkey = findCommandHotkey(bindings, GLOBAL_DICTATION_HOLD_COMMAND);
    if (holdHotkey) {
      return {
        hotkey: holdHotkey,
        commandId: GLOBAL_DICTATION_HOLD_COMMAND,
        source: "codex-keybindings",
      };
    }
  } catch {
    return {
      hotkey: null,
      commandId: null,
      source: "none",
    };
  }
  return {
    hotkey: null,
    commandId: null,
    source: "none",
  };
}

function findCommandHotkey(entries: unknown[], command: string): string | null {
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const candidate = entry as KeybindingEntry;
    if (candidate.command !== command) continue;
    if (typeof candidate.key === "string" && candidate.key.trim()) {
      return candidate.key.trim();
    }
  }
  return null;
}

function normalizeModifier(value: string): string | null {
  switch (value.toLowerCase()) {
    case "cmdorctrl":
    case "commandorcontrol":
    case "control":
    case "ctrl":
      return "control";
    case "alt":
    case "option":
      return "alt";
    case "shift":
      return "shift";
    default:
      return null;
  }
}

function formatSendKey(key: string): string {
  const normalized = key.trim();
  if (/^[a-z0-9]$/i.test(normalized)) return normalized.toLowerCase();
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(normalized))
    return `{${normalized.toUpperCase()}}`;
  switch (normalized.toLowerCase()) {
    case "space":
      return " ";
    case "enter":
    case "return":
      return "{ENTER}";
    case "escape":
    case "esc":
      return "{ESC}";
    case "tab":
      return "{TAB}";
    case "backspace":
      return "{BACKSPACE}";
    case "delete":
    case "del":
      return "{DELETE}";
    case "up":
      return "{UP}";
    case "down":
      return "{DOWN}";
    case "left":
      return "{LEFT}";
    case "right":
      return "{RIGHT}";
    default:
      throw new Error(`Unsupported dictation hotkey key: ${key}`);
  }
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}
