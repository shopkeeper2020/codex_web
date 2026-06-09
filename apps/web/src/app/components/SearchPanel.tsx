import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
} from "react";
import { useEffect, useRef, useState } from "react";
import {
  searchThreads,
  type Project,
  type Thread,
  type ThreadList,
  type ThreadSearchResult,
} from "../../api";
import styles from "../App.module.css";
import { displayTextFromReferencedPrompt } from "../textReferences";

function projectForThread(thread: Thread, projects: Project[]): Project | null {
  if (!thread.projectId) return null;
  return projects.find((project) => project.id === thread.projectId) ?? null;
}

type SearchRow = {
  thread: Thread;
  snippet: string;
};

type SearchPanelProps = {
  open: boolean;
  threadList: ThreadList;
  onClose: () => void;
  onSelectThread: (threadId: string) => void;
};

export function SearchPanel({
  open,
  threadList,
  onClose,
  onSelectThread,
}: SearchPanelProps): ReactElement | null {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ThreadSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchTerm = query.trim();

  const rows: SearchRow[] = searchTerm
    ? results.map((entry) => ({
        thread: entry.thread,
        snippet: entry.snippet,
      }))
    : threadList.threads.slice(0, 9).map((thread) => ({
        thread,
        snippet: "",
      }));

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlightedIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchTerm]);

  useEffect(() => {
    if (!open || !searchTerm) {
      setResults([]);
      setSearchError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setSearchError(null);
    setResults([]);
    const timeout = window.setTimeout(() => {
      void searchThreads({ searchTerm, archived: false, limit: 9 })
        .then((payload) => {
          if (!cancelled) setResults(payload.results);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setResults([]);
            setSearchError(
              error instanceof Error ? error.message : String(error),
            );
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [open, searchTerm]);

  useEffect(() => {
    if (highlightedIndex >= rows.length) {
      setHighlightedIndex(Math.max(0, rows.length - 1));
    }
  }, [highlightedIndex, rows.length]);

  useEffect(() => {
    rowRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, rows.length]);

  if (!open) return null;

  function selectRow(row: SearchRow): void {
    onSelectThread(row.thread.id);
    onClose();
  }

  function handleInputKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key === "Escape") {
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rows.length > 0)
        setHighlightedIndex((index) => (index + 1) % rows.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length > 0)
        setHighlightedIndex(
          (index) => (index - 1 + rows.length) % rows.length,
        );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (rows.length > 0) selectRow(rows[highlightedIndex]!);
      return;
    }

    const shortcutIndex = Number(event.key) - 1;
    if (
      (event.ctrlKey || event.metaKey) &&
      shortcutIndex >= 0 &&
      shortcutIndex < rows.length
    ) {
      event.preventDefault();
      selectRow(rows[shortcutIndex]!);
    }
  }

  return (
    <div
      className={styles.searchLayer}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <button
        className={styles.searchScrim}
        type="button"
        aria-label="关闭搜索"
        onClick={onClose}
      />
      <section className={styles.searchDialog}>
        <label className={styles.searchCommandInput}>
          <input
            ref={inputRef}
            type="search"
            aria-label="全局搜索"
            placeholder="搜索对话"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </label>

        <div className={styles.searchCommandList}>
          {!searchTerm ? (
            <div className={styles.searchSectionLabel}>近期对话</div>
          ) : null}

          {rows.map((row, index) => {
            const project = projectForThread(row.thread, threadList.projects);
            const displayTitle = displayTextFromReferencedPrompt(row.thread.title);
            return (
              <button
                className={
                  index === highlightedIndex
                    ? styles.searchCommandRowActive
                    : styles.searchCommandRow
                }
                type="button"
                key={row.thread.id}
                ref={(node) => {
                  rowRefs.current[index] = node;
                }}
                aria-selected={index === highlightedIndex}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectRow(row)}
              >
                <span className={styles.searchCommandText}>
                  <strong>{displayTitle}</strong>
                  {searchTerm ? (
                    <small>{row.snippet}</small>
                  ) : (
                    <small>{project?.name ?? row.thread.path ?? ""}</small>
                  )}
                </span>
                <span className={styles.searchProjectName}>
                  {project?.name ?? row.thread.path ?? ""}
                </span>
                <kbd className={styles.searchShortcut}>Ctrl+{index + 1}</kbd>
              </button>
            );
          })}

          {searchTerm && loading ? (
            <div className={styles.searchStatus}>搜索中...</div>
          ) : null}
          {searchTerm && !loading && searchError ? (
            <div className={styles.searchStatus}>{searchError}</div>
          ) : null}
          {searchTerm && !loading && !searchError && rows.length === 0 ? (
            <div className={styles.searchStatus}>没有结果</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
