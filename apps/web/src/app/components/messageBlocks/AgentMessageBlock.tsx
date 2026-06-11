import type { ReactElement } from "react";
import type { MessageItem } from "../../../api";
import {
  readMessageImages,
  readMessageItemText,
} from "../../officialThreadItems";
import styles from "../../App.module.css";
import {
  MarkdownText,
  MessageImages,
  type FileReferenceOptions,
} from "./shared";

export type AgentMessageBlockItem = Extract<MessageItem, { type: "agentMessage" }>;

export function AgentMessageBlock({
  item,
  onOpenFileReference,
  projectRoot,
}: {
  item: AgentMessageBlockItem;
  projectRoot?: string | null;
  onOpenFileReference?: (path: string) => void;
} & FileReferenceOptions): ReactElement {
  const text = readMessageItemText(item);
  return (
    <article className={styles.plainAssistantMessage} key={item.id}>
      <MarkdownText
        onOpenFileReference={onOpenFileReference}
        projectRoot={projectRoot}
        text={text}
      />
      <MessageImages images={readMessageImages(item)} projectRoot={projectRoot} />
    </article>
  );
}
