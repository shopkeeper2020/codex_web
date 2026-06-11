import {
  Check,
  ChevronDown,
  Clipboard,
  MessageSquare,
  Pencil,
} from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import type { MessageItem } from "../../../api";
import { useI18n } from "../../../i18n/useI18n";
import {
  formatReferenceQuote,
  parseReferencedPrompt,
  userRequestTextFromReferencedPrompt,
  type ComposerTextReference,
} from "../../textReferences";
import {
  asThreadItemRecord,
  readMessageImages,
  readMessageItemText,
  readThreadItemString,
} from "../../officialThreadItems";
import styles from "../../App.module.css";
import {
  MessageImages,
  writeClipboard,
} from "./shared";

export type UserMessageBlockItem = Extract<MessageItem, { type: "userMessage" }>;

export type UserMessageActions = {
  timeLabel?: string;
  canEdit?: boolean;
  onEdit?: () => void;
  isEditing?: boolean;
  editText?: string;
  onCancelEdit?: () => void;
  onSubmitEdit?: (text: string) => Promise<void> | void;
};

const USER_MESSAGE_COLLAPSE_LINE_COUNT = 9;
const USER_MESSAGE_COLLAPSE_CHAR_COUNT = 560;

function shouldCollapseUserText(text: string): boolean {
  return (
    text.length > USER_MESSAGE_COLLAPSE_CHAR_COUNT ||
    text.split(/\r?\n/).length > USER_MESSAGE_COLLAPSE_LINE_COUNT
  );
}

function UserTextReferenceChip({
  references,
}: {
  references: ComposerTextReference[];
}): ReactElement {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const label = t("textReference.chip.count", { count: references.length });

  return (
    <span
      className={styles.messageTextReferenceChipWrap}
      data-expanded={expanded ? "true" : undefined}
    >
      <button
        aria-expanded={expanded}
        aria-label={label}
        className={styles.messageTextReferenceChip}
        data-testid="message-text-reference-chip"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <MessageSquare size={14} />
        <span>{label}</span>
      </button>
      <span
        className={styles.messageTextReferencePreview}
        data-testid="message-text-reference-preview"
        role="tooltip"
      >
        {references.map((reference) => (
          <span
            className={styles.textReferencePreviewLine}
            key={reference.id}
          >
            {formatReferenceQuote(reference.text)}
          </span>
        ))}
      </span>
    </span>
  );
}

function UserPlainText({ text }: { text: string }): ReactElement | null {
  const referencedPrompt = parseReferencedPrompt(text);
  const displayText = userRequestTextFromReferencedPrompt(text);
  const shouldCollapse = shouldCollapseUserText(displayText);
  const [expanded, setExpanded] = useState(false);
  const collapsed = shouldCollapse && !expanded;

  if (!text) return null;

  if (referencedPrompt) {
    return (
      <>
        <UserTextReferenceChip references={referencedPrompt.references} />
        {displayText ? (
          <div
            className={styles.userMessageBubble}
            data-collapsed={collapsed ? "true" : undefined}
            data-testid="user-message-bubble"
          >
            <div className={styles.userMessageText} data-testid="user-message-text">
              {displayText}
            </div>
            {shouldCollapse ? (
              <button
                aria-expanded={expanded}
                aria-label={expanded ? "折叠用户消息" : "展开用户消息"}
                className={styles.userMessageToggle}
                onClick={() => setExpanded((value) => !value)}
                type="button"
              >
                {expanded ? "收起" : "显示更多"}
                <ChevronDown className={expanded ? styles.userMessageToggleIconOpen : styles.userMessageToggleIcon} size={14} />
              </button>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div
      className={styles.userMessageBubble}
      data-collapsed={collapsed ? "true" : undefined}
      data-testid="user-message-bubble"
    >
      <div className={styles.userMessageText} data-testid="user-message-text">
        {displayText}
      </div>
      {shouldCollapse ? (
        <button
          aria-expanded={expanded}
          aria-label={expanded ? "折叠用户消息" : "展开用户消息"}
          className={styles.userMessageToggle}
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "收起" : "显示更多"}
          <ChevronDown className={expanded ? styles.userMessageToggleIconOpen : styles.userMessageToggleIcon} size={14} />
        </button>
      ) : null}
    </div>
  );
}

function UserMessageActionRow({
  actions,
  text,
}: {
  actions: UserMessageActions | null;
  text: string;
}): ReactElement | null {
  const [copied, setCopied] = useState(false);
  const copyText = userRequestTextFromReferencedPrompt(text);
  const hasCopyText = copyText.length > 0;
  if (!actions) return null;

  return (
    <div className={styles.userMessageActions} data-testid="user-message-actions">
      {actions.timeLabel ? <span>{actions.timeLabel}</span> : null}
      <button
        aria-label="复制用户消息"
        disabled={!hasCopyText}
        onClick={() => {
          if (!hasCopyText) return;
          void writeClipboard(copyText).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
        title="复制"
        type="button"
      >
        {copied ? <Check size={13} /> : <Clipboard size={13} />}
      </button>
      {actions.canEdit && actions.onEdit ? (
        <button
          aria-label="编辑用户消息"
          onClick={actions.onEdit}
          title="编辑"
          type="button"
        >
          <Pencil size={13} />
        </button>
      ) : null}
    </div>
  );
}

function UserMessageEditor({
  actions,
  text,
}: {
  actions: UserMessageActions;
  text: string;
}): ReactElement | null {
  const initialText = actions.editText ?? text;
  const [draft, setDraft] = useState(initialText);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasDraft = draft.length > 0;

  useEffect(() => {
    setDraft(initialText);
  }, [initialText]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [initialText]);

  if (!actions.isEditing || !actions.onCancelEdit || !actions.onSubmitEdit) {
    return null;
  }

  const submit = async (): Promise<void> => {
    if (!hasDraft || submitting) return;
    setSubmitting(true);
    try {
      await actions.onSubmitEdit?.(draft);
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <form
      className={styles.userMessageEditor}
      data-testid="user-message-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="编辑用户消息"
        disabled={submitting}
        onChange={(event) => {
          setDraft(event.target.value);
          event.currentTarget.style.height = "auto";
          event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            actions.onCancelEdit?.();
          }
        }}
        ref={textareaRef}
        rows={1}
        value={draft}
      />
      <div className={styles.userMessageEditorActions}>
        <button disabled={submitting} onClick={actions.onCancelEdit} type="button">
          取消
        </button>
        <button disabled={!hasDraft || submitting} type="submit">
          发送
        </button>
      </div>
    </form>
  );
}

export function UserMessageBlock({
  actions,
  item,
  projectRoot,
}: {
  item: UserMessageBlockItem;
  actions: UserMessageActions | null;
  projectRoot?: string | null;
}): ReactElement {
  const text = readMessageItemText(item);
  const images = readMessageImages(item);
  const referencedPrompt = parseReferencedPrompt(text);

  return (
    <article className={styles.userMessage} data-testid="user-message" key={item.id}>
      <MessageImages images={images} projectRoot={projectRoot} />
      {actions?.isEditing ? (
        <>
          {referencedPrompt ? <UserTextReferenceChip references={referencedPrompt.references} /> : null}
          <UserMessageEditor actions={actions} text={referencedPrompt?.request ?? text} />
        </>
      ) : (
        <>
          <UserPlainText text={text} />
          <UserMessageActionRow actions={actions} text={text} />
        </>
      )}
    </article>
  );
}

export function userMessageActionsForItem({
  getUserMessageActions,
  item,
}: {
  item: UserMessageBlockItem;
  getUserMessageActions?: (item: UserMessageBlockItem) => UserMessageActions | null;
}): UserMessageActions | null {
  const intent = readThreadItemString(asThreadItemRecord(item)?.intent);
  return intent === "guidance" ? null : getUserMessageActions?.(item) ?? null;
}
