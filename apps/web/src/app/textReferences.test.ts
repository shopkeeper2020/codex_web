import { describe, expect, it } from "vitest";
import {
  formatReferencedPrompt,
  formatReferenceQuote,
  displayTextFromReferencedPrompt,
  normalizeSelectionText,
  parseReferencedPrompt,
  userRequestTextFromReferencedPrompt,
} from "./textReferences";

describe("textReferences", () => {
  it("formats selected text with the Desktop prompt structure", () => {
    const text = formatReferencedPrompt("分别列表格", [
      { id: "a", text: "深圳", preview: "深圳" },
      { id: "b", text: "广州", preview: "广州" },
    ]);

    expect(text).toBe(
      [
        "# Selected text:",
        "## Selection 1",
        "深圳",
        "",
        "## Selection 2",
        "广州",
        "",
        "## My request for Codex:",
        "分别列表格",
      ].join("\n"),
    );
  });

  it("allows a prompt with references and an empty request", () => {
    const text = formatReferencedPrompt("", [
      { id: "a", text: "深圳", preview: "深圳" },
    ]);

    expect(text).toContain("## My request for Codex:\n");
    expect(parseReferencedPrompt(text)).toMatchObject({
      request: "",
      references: [{ text: "深圳" }],
    });
  });

  it("parses referenced prompts back into request and selections", () => {
    const parsed = parseReferencedPrompt(
      [
        "# Selected text:",
        "## Selection 1",
        "第一段",
        "第二行",
        "",
        "## Selection 2",
        "另一段",
        "",
        "## My request for Codex:",
        "总结一下",
      ].join("\n"),
    );

    expect(parsed?.request).toBe("总结一下");
    expect(parsed?.references.map((reference) => reference.text)).toEqual([
      "第一段\n第二行",
      "另一段",
    ]);
  });

  it("normalizes selection text and formats quoted previews", () => {
    expect(normalizeSelectionText("  A\u00a0B\r\nC  ")).toBe("A B\nC");
    expect(formatReferenceQuote(" 深圳 ")).toBe('"深圳"');
  });

  it("uses the request text as the display title for referenced prompts", () => {
    const prompt = formatReferencedPrompt("分别列表格", [
      { id: "a", text: "深圳", preview: "深圳" },
    ]);
    const referenceOnlyPrompt = formatReferencedPrompt("", [
      { id: "a", text: "只引用这一段", preview: "只引用这一段" },
    ]);

    expect(displayTextFromReferencedPrompt(prompt)).toBe("分别列表格");
    expect(displayTextFromReferencedPrompt(referenceOnlyPrompt)).toBe(
      "只引用这一段",
    );
    expect(displayTextFromReferencedPrompt("普通标题")).toBe("普通标题");
  });

  it("uses only the request body as copy text for referenced prompts", () => {
    const prompt = formatReferencedPrompt("這個爲什麽沒有？你看一下官方的codex文檔", [
      { id: "a", text: "技能文档说优先用内建 image_gen", preview: "技能文档" },
    ]);
    const referenceOnlyPrompt = formatReferencedPrompt("", [
      { id: "a", text: "只引用这一段", preview: "只引用这一段" },
    ]);

    expect(userRequestTextFromReferencedPrompt(prompt)).toBe(
      "這個爲什麽沒有？你看一下官方的codex文檔",
    );
    expect(userRequestTextFromReferencedPrompt(referenceOnlyPrompt)).toBe("");
    expect(userRequestTextFromReferencedPrompt("普通消息")).toBe("普通消息");
  });

  it("hides files-mentioned scaffolding from display and copy text", () => {
    const prompt = [
      "# Files mentioned by the user:",
      "",
      "## PixPin_2026-06-08_15-54-50.png:",
      "C:/Users/user/AppData/Local/PixPin/Temp/PixPin_2026-06-08_15-54-50.png",
      "",
      "## My request for Codex:",
      "幫我完善會話區的交互功能。",
    ].join("\n");

    expect(displayTextFromReferencedPrompt(prompt)).toBe(
      "幫我完善會話區的交互功能。",
    );
    expect(userRequestTextFromReferencedPrompt(prompt)).toBe(
      "幫我完善會話區的交互功能。",
    );
    expect(parseReferencedPrompt(prompt)).toBeNull();
  });

  it("hides files-mentioned scaffolding when official content loses the blank separator", () => {
    const prompt = [
      "",
      "# Files mentioned by the user:",
      "",
      "## codex-clipboard-ca7e04e6-f581-435f-8cf7-e75ea70382b0.png:",
      "C:/Users/user/AppData/Local/Temp/codex-clipboard-ca7e04e6-f581-435f-8cf7-e75ea70382b0.png",
      "## My request for Codex:",
      "我希望給圖片預覽的時候，增加鼠標滾輪可以放大縮小拖動的功能",
    ].join("\n");

    expect(displayTextFromReferencedPrompt(prompt)).toBe(
      "我希望給圖片預覽的時候，增加鼠標滾輪可以放大縮小拖動的功能",
    );
    expect(userRequestTextFromReferencedPrompt(prompt)).toBe(
      "我希望給圖片預覽的時候，增加鼠標滾輪可以放大縮小拖動的功能",
    );
  });
});
