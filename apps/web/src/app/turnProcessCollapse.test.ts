import type { MessageItem } from "@codex-web/domain";
import { describe, expect, it } from "vitest";
import { deriveTurnProcessCollapse } from "./turnProcessCollapse";

const userItem: MessageItem = {
  type: "userMessage",
  id: "user-1",
  clientId: null,
  content: [{ type: "text", text: "修一下测试" }],
};

function commandItem(status = "completed", exitCode: number | null = 0): MessageItem {
  return {
    type: "commandExecution",
    id: `command-${status}`,
    command: "pnpm test",
    status,
    aggregatedOutput: "ok",
    stdout: "ok",
    stderr: "",
    cwd: null,
    processId: null,
    source: null,
    commandActions: [],
    durationMs: null,
    exitCode,
  };
}

function agentItem(
  id: string,
  text: string,
  phase: "commentary" | "final_answer" | null,
): MessageItem {
  return {
    type: "agentMessage",
    id,
    text,
    phase,
    memoryCitation: null,
  };
}

describe("deriveTurnProcessCollapse", () => {
  it("collapses completed process items before a final answer phase", () => {
    const command = commandItem();
    const final = agentItem("final-1", "已经修好。", "final_answer");
    const layout = deriveTurnProcessCollapse([userItem, command, final], "active");

    expect(layout).toMatchObject({
      source: "phase",
      finalAnswerIndex: 2,
      beforeItems: [{ id: "user-1" }],
      processItems: [{ id: command.id }],
      finalAndAfterItems: [{ id: "final-1" }],
    });
  });

  it("treats commentary agent messages before final answer as process", () => {
    const commentary = agentItem("commentary-1", "我先检查测试。", "commentary");
    const command = commandItem();
    const final = agentItem("final-1", "测试通过。", "final_answer");
    const layout = deriveTurnProcessCollapse(
      [userItem, commentary, command, final],
      "completed",
    );

    expect(layout?.processItems.map((item) => item.id)).toEqual([
      "commentary-1",
      command.id,
    ]);
  });

  it("does not collapse active operations", () => {
    const runningCommand = commandItem("running", null);
    const final = agentItem("final-1", "我已经开始整理结论。", "final_answer");

    expect(
      deriveTurnProcessCollapse([userItem, runningCommand, final], "active"),
    ).toBeNull();
  });

  it("collapses canonical web search items without status before final answer", () => {
    const webSearch: MessageItem = {
      type: "webSearch",
      id: "search-a",
      query: "codex desktop ipc",
      action: null,
    };
    const final = agentItem("final-1", "已经找到资料。", "final_answer");
    const layout = deriveTurnProcessCollapse([userItem, webSearch, final], "active");

    expect(layout).toMatchObject({
      source: "phase",
      processItems: [{ id: "search-a" }],
      finalAndAfterItems: [{ id: "final-1" }],
    });
  });

  it("does not collapse active canonical web search items", () => {
    const webSearch: MessageItem = {
      type: "webSearch",
      id: "search-active",
      query: "codex desktop ipc",
      action: null,
      status: "active",
    };
    const final = agentItem("final-1", "我先给结论。", "final_answer");

    expect(deriveTurnProcessCollapse([userItem, webSearch, final], "active")).toBeNull();
  });

  it("treats declined command executions as terminal process items", () => {
    const declinedCommand = commandItem("declined", null);
    const final = agentItem("final-1", "命令已被拒绝，我继续说明。", "final_answer");
    const layout = deriveTurnProcessCollapse([userItem, declinedCommand, final], "active");

    expect(layout?.processItems.map((item) => item.id)).toEqual([declinedCommand.id]);
  });

  it("invalidates collapse when a process item appears after final answer", () => {
    const final = agentItem("final-1", "先给结论。", "final_answer");
    const command = commandItem();

    expect(deriveTurnProcessCollapse([userItem, final, command], "active")).toBeNull();
  });

  it("uses a minimal fallback for old data without phase", () => {
    const command = commandItem();
    const final = agentItem("legacy-final", "旧数据里的最终回复。", null);
    const layout = deriveTurnProcessCollapse([userItem, command, final], "completed");

    expect(layout).toMatchObject({
      source: "fallback",
      processItems: [{ id: command.id }],
      finalAndAfterItems: [{ id: "legacy-final" }],
    });
  });

  it("does not treat commentary as a fallback final answer", () => {
    const command = commandItem();
    const commentary = agentItem("commentary-1", "还在处理。", "commentary");

    expect(deriveTurnProcessCollapse([userItem, command, commentary], "active")).toBeNull();
  });
});
