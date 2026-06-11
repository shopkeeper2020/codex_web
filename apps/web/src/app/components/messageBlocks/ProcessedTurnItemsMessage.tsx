import { CheckCircle2, Maximize2, Minimize2 } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import type { MessageItem } from "../../../api";
import styles from "../../App.module.css";

export function ProcessedTurnItemsMessage({
  items,
  renderItems,
  turnStatus,
}: {
  items: MessageItem[];
  renderItems: (items: MessageItem[], turnStatus: string) => ReactElement[];
  turnStatus: string;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const meta = items.length === 1 ? "1 项" : `${items.length} 项`;
  return (
    <article className={styles.assistantMessage} data-testid="processed-turn-items">
      <button
        aria-expanded={expanded}
        aria-label={expanded ? "折叠内容" : "展开内容"}
        className={styles.collapsedMessageToggle}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className={styles.avatar}>
          <CheckCircle2 size={16} />
        </span>
        <span className={styles.collapsedMessageText}>
          <span className={styles.authorName}>已处理</span>
          <span className={styles.authorMeta}>{meta}</span>
        </span>
        <span className={styles.collapsedMessageAction}>
          {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </span>
      </button>
      {expanded ? (
        <div className={styles.groupedMessageBody}>
          {renderItems(items, turnStatus)}
        </div>
      ) : null}
    </article>
  );
}
