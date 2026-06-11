import type { MessageItem } from "@codex-web/domain";
import { describe, expect, it } from "vitest";
import {
  isAgentMessageItem,
  isCommandExecutionItem,
  isToolLikeItem,
  isUserMessageItem,
  migrateLegacyMessageItemForRender,
  readCommandOutput,
  readFileChangeEntries,
  readMessageItemText,
} from "./officialThreadItems";

describe("officialThreadItems", () => {
  it("reads text from canonical official message items", () => {
    const user: MessageItem = {
      type: "userMessage",
      id: "user-1",
      clientId: "desktop-client",
      content: [
        { type: "text", text: "  第一行  " },
        { type: "text", text: "\t第二行\n" },
      ],
    };
    const agent: MessageItem = {
      type: "agentMessage",
      id: "agent-1",
      text: "最终回复",
      phase: "final_answer",
      memoryCitation: { source: "memory-a" },
    };

    expect(readMessageItemText(user)).toBe("  第一行  \n\t第二行\n");
    expect(readMessageItemText(agent)).toBe("最终回复");
  });

  it("reads commandExecution output without converting it to legacy command", () => {
    const command: MessageItem = {
      type: "commandExecution",
      id: "command-1",
      command: "pnpm test",
      status: "completed",
      aggregatedOutput: "ok",
      cwd: "C:\\workspace\\codex_web",
      processId: null,
      source: null,
      commandActions: [],
      durationMs: 123,
      exitCode: 0,
    };

    expect(readCommandOutput(command)).toMatchObject({
      command: "pnpm test",
      output: "ok",
      cwd: "C:\\workspace\\codex_web",
      exitCode: 0,
    });
  });

  it("keeps official file change kind objects intact", () => {
    const fileChange: MessageItem = {
      type: "fileChange",
      id: "file-change-1",
      status: "completed",
      changes: [
        {
          path: "src/index.ts",
          kind: { type: "update", move_path: "src/main.ts" },
          diff: "@@\n-old\n+new",
        },
      ],
    };

    expect(readFileChangeEntries(fileChange)[0]?.kind).toEqual({
      type: "update",
      move_path: "src/main.ts",
    });
  });

  it("migrates legacy Web message shapes at the renderer boundary", () => {
    const assistant = { type: "assistant", id: "a", text: "old" } as MessageItem;
    const user = { type: "user", id: "u", text: "old" } as MessageItem;

    expect(isAgentMessageItem(assistant)).toBe(false);
    expect(isUserMessageItem(user)).toBe(false);
    expect(migrateLegacyMessageItemForRender(assistant)).toMatchObject({
      type: "agentMessage",
      id: "a",
      text: "old",
      phase: null,
      memoryCitation: null,
    });
    expect(migrateLegacyMessageItemForRender(user)).toMatchObject({
      type: "userMessage",
      id: "u",
      clientId: null,
      content: [{ type: "text", text: "old" }],
    });
    expect(
      isCommandExecutionItem({
        type: "command",
        id: "c",
        command: "pnpm test",
        output: "",
        stdout: "",
        stderr: "",
        cwd: null,
        status: "completed",
        durationMs: null,
        exitCode: 0,
      }),
    ).toBe(true);
    expect(
      isToolLikeItem({
        type: "webSearch",
        id: "search-1",
        query: "codex app-server",
        action: null,
        results: [],
      } as MessageItem),
    ).toBe(true);
  });
});
