import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  acceleratorToWindowsSendKeys,
  getNativeDictationStatus,
  triggerNativeDictation,
} from "./nativeDictation.js";

describe("native dictation bridge", () => {
  it("converts Electron accelerators to Windows SendKeys", () => {
    expect(acceleratorToWindowsSendKeys("Ctrl+Alt+Shift+D")).toBe("^%+d");
    expect(acceleratorToWindowsSendKeys("CmdOrCtrl+Shift+F12")).toBe(
      "^+{F12}",
    );
  });

  it("prefers the official global toggle keybinding", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-web-dictation-"));
    writeFileSync(
      join(codexHome, "keybindings.json"),
      JSON.stringify([
        { command: "globalDictationHold", key: "Ctrl+Shift+H" },
        { command: "globalDictationToggle", key: "Ctrl+Alt+D" },
      ]),
    );

    expect(
      getNativeDictationStatus({
        codexHome,
        env: {},
        platform: "win32",
      }),
    ).toMatchObject({
      supported: true,
      configured: true,
      hotkey: "Ctrl+Alt+D",
      commandId: "globalDictationToggle",
      source: "codex-keybindings",
      warning: null,
    });
  });

  it("reports when no official global hotkey is configured", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-web-dictation-"));

    expect(
      getNativeDictationStatus({
        codexHome,
        env: {},
        platform: "win32",
      }),
    ).toMatchObject({
      supported: true,
      configured: false,
      hotkey: null,
      source: "none",
    });
  });

  it("triggers the configured hotkey through PowerShell", async () => {
    const execFile = vi.fn(async () => undefined);

    await expect(
      triggerNativeDictation({
        env: { CODEX_WEB_NATIVE_DICTATION_HOTKEY: "Ctrl+Alt+D" },
        execFile,
        platform: "win32",
      }),
    ).resolves.toMatchObject({
      ok: true,
      hotkey: "Ctrl+Alt+D",
      source: "environment",
    });

    expect(execFile).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining([
        "-STA",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        expect.stringContaining("[System.Windows.Forms.SendKeys]::SendWait"),
      ]),
      { windowsHide: true },
    );
  });
});
