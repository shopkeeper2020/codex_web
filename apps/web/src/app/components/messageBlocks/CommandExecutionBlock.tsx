import { TerminalSquare } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import type { MessageItem } from "../../../api";
import { readCommandOutput } from "../../officialThreadItems";
import styles from "../../App.module.css";
import {
  CollapsedMessageToggle,
  CopyButton,
  isActiveMessageStatus,
} from "./shared";

export type CommandExecutionBlockItem =
  | Extract<MessageItem, { type: "command" }>
  | Extract<MessageItem, { type: "commandExecution" }>;

export function commandOutputText(item: CommandExecutionBlockItem): string {
  const command = readCommandOutput(item);
  const lines: string[] = [];
  if (command?.command) lines.push(`$ ${command.command}`);
  const output = command?.output || command?.stdout || "";
  if (output) {
    if (lines.length) lines.push("");
    lines.push(output);
  }
  if (command?.stderr) {
    if (lines.length) lines.push("");
    lines.push(command.stderr);
  }
  return lines.length ? lines.join("\n") : "暂无输出";
}

function commandFooterLabel(item: CommandExecutionBlockItem): string {
  const command = readCommandOutput(item);
  if (command?.status === "declined") return "已拒绝";
  if (command && (command.status === "failed" || (command.exitCode !== null && command.exitCode !== 0))) return "失败";
  if (isActiveMessageStatus(command?.status) && command?.exitCode === null) return "运行中";
  return "成功";
}

export function CommandBlockDetails({
  item,
}: {
  item: CommandExecutionBlockItem;
}): ReactElement {
  const output = commandOutputText(item);
  return (
    <div className={styles.shellCommandBlock}>
      <div className={styles.shellCommandHeader}>
        <span>Shell</span>
        <CopyButton text={output} label="复制命令输出" />
      </div>
      <pre className={styles.shellCommandPre}>{output}</pre>
      <div className={styles.shellCommandFooter}>
        <span>{commandFooterLabel(item)}</span>
      </div>
    </div>
  );
}

export function CommandExecutionBlock({
  item,
  turnStatus,
}: {
  item: CommandExecutionBlockItem;
  turnStatus: string;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const command = readCommandOutput(item);
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <CollapsedMessageToggle
        active={isActiveMessageStatus(command?.status)}
        expanded={expanded}
        icon={<TerminalSquare size={16} />}
        label="命令"
        meta={command?.status || turnStatus}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? <CommandBlockDetails item={item} /> : null}
    </article>
  );
}
