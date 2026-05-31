import { Archive, Folder, MessageSquare, Search, X } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import type { Project, Thread, ThreadList } from "../../api";
import styles from "../App.module.css";

function formatTime(value: string | null): string {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function projectForThread(thread: Thread, projects: Project[]): Project | null {
  if (!thread.projectId) return null;
  return projects.find((project) => project.id === thread.projectId) ?? null;
}

type SearchPanelProps = {
  open: boolean;
  threadList: ThreadList;
  archivedThreads: Thread[];
  selectedThreadId: string;
  onClose: () => void;
  onSelectThread: (threadId: string) => void;
  onSelectProject: (projectId: string | null) => void;
  onRestoreThread: (threadId: string) => Promise<void>;
};

export function SearchPanel({
  open,
  threadList,
  archivedThreads,
  selectedThreadId,
  onClose,
  onSelectThread,
  onSelectProject,
  onRestoreThread,
}: SearchPanelProps): ReactElement | null {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  if (!open) return null;

  const projectMatches = (project: Project) =>
    !normalizedQuery ||
    [project.name, project.path ?? project.id].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    );
  const threadMatches = (thread: Thread) => {
    const project = projectForThread(thread, threadList.projects);
    return (
      !normalizedQuery ||
      [
        thread.title,
        thread.path ?? "",
        thread.projectId ?? "",
        project?.name ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
    );
  };
  const projects = threadList.projects.filter(projectMatches).slice(0, 8);
  const threads = threadList.threads.filter(threadMatches).slice(0, 12);
  const archived = archivedThreads.filter(threadMatches).slice(0, 6);

  async function restoreArchived(threadId: string): Promise<void> {
    await onRestoreThread(threadId);
    onClose();
  }

  return (
    <div
      className={styles.searchLayer}
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-search-title"
    >
      <button
        className={styles.searchScrim}
        type="button"
        aria-label="关闭搜索"
        onClick={onClose}
      />
      <section className={styles.searchDialog}>
        <header className={styles.searchHeader}>
          <Search size={18} />
          <h2 id="global-search-title">Search</h2>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="关闭搜索"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <label className={styles.searchInput}>
          <Search size={16} />
          <input
            ref={inputRef}
            type="search"
            aria-label="全局搜索"
            placeholder="搜索项目、会话或路径"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
          />
        </label>
        <div className={styles.searchResults}>
          <section className={styles.searchGroup}>
            <h3>Projects</h3>
            {projects.map((project) => (
              <button
                className={styles.searchResultRow}
                type="button"
                key={project.id}
                onClick={() => {
                  onSelectProject(project.id);
                  onClose();
                }}
              >
                <Folder size={16} />
                <span>
                  <strong>{project.name}</strong>
                  <small>
                    {project.source === "web-favorite" ? "本地收藏" : "官方"} ·{" "}
                    {project.path ?? project.id}
                  </small>
                </span>
              </button>
            ))}
            {projects.length === 0 ? (
              <div className={styles.searchEmpty}>没有匹配项目</div>
            ) : null}
          </section>

          <section className={styles.searchGroup}>
            <h3>Threads</h3>
            {threads.map((thread) => {
              const project = projectForThread(thread, threadList.projects);
              return (
                <button
                  className={
                    thread.id === selectedThreadId
                      ? styles.searchResultRowActive
                      : styles.searchResultRow
                  }
                  type="button"
                  key={thread.id}
                  onClick={() => {
                    onSelectThread(thread.id);
                    onClose();
                  }}
                >
                  <MessageSquare size={16} />
                  <span>
                    <strong>{thread.title}</strong>
                    <small>
                      {project?.name ?? thread.path ?? "无项目会话"} ·{" "}
                      {thread.inProgress
                        ? "live"
                        : formatTime(thread.updatedAtIso)}
                    </small>
                  </span>
                </button>
              );
            })}
            {threads.length === 0 ? (
              <div className={styles.searchEmpty}>没有匹配会话</div>
            ) : null}
          </section>

          {archived.length > 0 ? (
            <section className={styles.searchGroup}>
              <h3>Archived</h3>
              {archived.map((thread) => (
                <button
                  className={styles.searchResultRow}
                  type="button"
                  key={thread.id}
                  onClick={() => void restoreArchived(thread.id)}
                >
                  <Archive size={16} />
                  <span>
                    <strong>{thread.title}</strong>
                    <small>点击恢复 · {formatTime(thread.updatedAtIso)}</small>
                  </span>
                </button>
              ))}
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}
