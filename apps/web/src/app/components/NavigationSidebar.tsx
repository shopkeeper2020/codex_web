import {
  Archive,
  ChevronDown,
  CircleUser,
  ExternalLink,
  Folder,
  Gauge,
  History,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  Pin,
  PinOff,
  Plus,
  Puzzle,
  Search,
  Settings,
  Sparkles,
  Square,
  SquarePen,
  X,
} from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  AccountStatus,
  AuthStatus,
  Project,
  Thread,
  ThreadList,
} from "../../api";
import styles from "../App.module.css";
import {
  calculateVirtualThreadWindow,
  initialThreadScrollTop,
  shouldVirtualizeThreadRows,
  THREAD_ROW_HEIGHT_PX,
  THREAD_ROW_MAX_VIEWPORT_PX,
} from "../virtualThreadRows";

export const NO_PROJECT_FILTER_ID = "__codex_web_no_project__";
const COLLAPSED_SECTION_LIMIT = 5;

function formatTime(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function ActivityDot({ active }: { active?: boolean }): ReactElement {
  return (
    <span
      className={active ? styles.activityDotActive : styles.activityDot}
      aria-hidden="true"
    />
  );
}

function Rail({
  onOpenDrawer,
  onOpenSearch,
  onOpenSettings,
  onCreateThread,
}: {
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onCreateThread: (cwd?: string | null) => void;
}): ReactElement {
  return (
    <nav className={styles.rail} aria-label="主导航">
      <button
        className={styles.mobileOnlyButton}
        type="button"
        aria-label="打开导航"
        onClick={onOpenDrawer}
      >
        <Menu size={19} />
      </button>
      <button
        className={styles.railButtonActive}
        type="button"
        aria-label="Home"
      >
        <Home size={19} />
      </button>
      <button
        className={styles.railButton}
        type="button"
        aria-label="New thread"
        onClick={() => onCreateThread()}
      >
        <SquarePen size={19} />
      </button>
      <button
        className={styles.railButton}
        type="button"
        aria-label="Search"
        onClick={onOpenSearch}
      >
        <Search size={19} />
      </button>
      <button className={styles.railButton} type="button" aria-label="Projects">
        <Folder size={19} />
      </button>
      <button className={styles.railButton} type="button" aria-label="History">
        <History size={19} />
      </button>
      <div className={styles.railSpacer} />
      <button className={styles.railButton} type="button" aria-label="Archive">
        <Archive size={19} />
      </button>
      <button
        className={styles.railButton}
        type="button"
        aria-label="Settings"
        onClick={onOpenSettings}
      >
        <Settings size={19} />
      </button>
    </nav>
  );
}

function projectForThread(thread: Thread, projects: Project[]): Project | null {
  if (!thread.projectId) return null;
  return projects.find((project) => project.id === thread.projectId) ?? null;
}

function threadMatchesProject(
  thread: Thread,
  projectId: string | null,
): boolean {
  if (!projectId) return true;
  if (projectId === NO_PROJECT_FILTER_ID) return !thread.projectId;
  return thread.projectId === projectId;
}

function limitedRows<T>(items: T[], expanded: boolean, searching: boolean): T[] {
  if (expanded || searching || items.length <= COLLAPSED_SECTION_LIMIT)
    return items;
  return items.slice(0, COLLAPSED_SECTION_LIMIT);
}

function ExpandRowsButton({
  expanded,
  hiddenCount,
  onToggle,
}: {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
}): ReactElement | null {
  if (hiddenCount <= 0) return null;
  return (
    <button className={styles.expandRowsButton} type="button" onClick={onToggle}>
      {expanded ? "收起显示" : "展开显示"}
      <span>{expanded ? "" : `+${hiddenCount}`}</span>
    </button>
  );
}

function settingsAccountLabel(
  auth: AuthStatus | null,
  accountStatus: AccountStatus | null,
): string {
  return (
    accountStatus?.account?.email ??
    (auth?.localBypass ? "本机免登录" : "LAN session")
  );
}

function SettingsAccountMenu({
  open,
  auth,
  accountStatus,
  onOpenSettings,
  onSignOut,
}: {
  open: boolean;
  auth: AuthStatus | null;
  accountStatus: AccountStatus | null;
  onOpenSettings: () => void;
  onSignOut: () => void;
}): ReactElement | null {
  if (!open) return null;
  const accountLabel = settingsAccountLabel(auth, accountStatus);
  return (
    <div className={styles.settingsAccountMenu} role="menu" aria-label="账户与设置">
      <div className={styles.settingsAccountIdentity}>
        <CircleUser size={16} />
        <span>{accountLabel}</span>
      </div>
      <button className={styles.settingsMenuItem} type="button" role="menuitem" disabled>
        <Settings size={15} />
        <span>个人账户</span>
      </button>
      <button className={styles.settingsMenuItem} type="button" role="menuitem" disabled>
        <Sparkles size={15} />
        <span>升级以获享更高限额</span>
        <ExternalLink size={13} />
      </button>
      <button className={styles.settingsMenuItem} type="button" role="menuitem" onClick={onOpenSettings}>
        <Settings size={15} />
        <span>设置</span>
      </button>
      <button className={styles.settingsMenuItem} type="button" role="menuitem" disabled>
        <Gauge size={15} />
        <span>剩余用量</span>
      </button>
      <button className={styles.settingsMenuItem} type="button" role="menuitem" onClick={onSignOut}>
        <LogOut size={15} />
        <span>退出登录</span>
      </button>
    </div>
  );
}

function ThreadRows({
  threads,
  projects,
  selectedThreadId,
  archived,
  onSelectThread,
  onRestoreThread,
  onTogglePinThread,
  onArchiveThread,
  onStopThreadBackground,
}: {
  threads: Thread[];
  projects: Project[];
  selectedThreadId: string;
  archived?: boolean;
  onSelectThread: (threadId: string) => void;
  onRestoreThread: (threadId: string) => void;
  onTogglePinThread: (threadId: string, pinned: boolean) => void;
  onArchiveThread: (threadId: string) => void;
  onStopThreadBackground: (threadId: string) => void;
}): ReactElement {
  const virtualize = shouldVirtualizeThreadRows(threads.length);
  const selectedIndex = threads.findIndex(
    (thread) => thread.id === selectedThreadId,
  );
  const viewportHeight = Math.min(
    THREAD_ROW_MAX_VIEWPORT_PX,
    threads.length * THREAD_ROW_HEIGHT_PX,
  );
  const [scrollTop, setScrollTop] = useState(() =>
    initialThreadScrollTop(selectedIndex, threads.length),
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!virtualize) return;
    const nextScrollTop = initialThreadScrollTop(selectedIndex, threads.length);
    setScrollTop(nextScrollTop);
    if (scrollerRef.current) scrollerRef.current.scrollTop = nextScrollTop;
  }, [selectedIndex, threads.length, virtualize]);

  const window = virtualize
    ? calculateVirtualThreadWindow({
        itemCount: threads.length,
        scrollTop,
        viewportHeight,
      })
    : null;
  const renderedThreads = window
    ? threads.slice(window.startIndex, window.endIndex)
    : threads;

  const rows = renderedThreads.map((thread) => {
    if (archived) {
      return (
        <button
          className={styles.threadRow}
          key={thread.id}
          type="button"
          onClick={() => onRestoreThread(thread.id)}
          title="恢复归档会话"
        >
          <Archive size={15} />
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>{thread.title}</span>
            <span className={styles.rowMeta}>
              点击恢复 · {formatTime(thread.updatedAtIso)}
            </span>
          </span>
          <span className={styles.threadTime}>restore</span>
        </button>
      );
    }

    const project = projectForThread(thread, projects);
    return (
      <div
        className={
          thread.id === selectedThreadId
            ? styles.threadRowShellActive
            : styles.threadRowShell
        }
        key={thread.id}
      >
        <button
          className={styles.threadRowMain}
          type="button"
          onClick={() => onSelectThread(thread.id)}
        >
          {thread.pinned ? (
            <Pin className={styles.threadPinIcon} size={15} fill="currentColor" />
          ) : (
            <MessageSquare size={15} />
          )}
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>{thread.title}</span>
            <span className={styles.rowMeta}>
              {project?.name ?? thread.path ?? "无项目会话"}
            </span>
          </span>
          <span className={styles.threadTime}>
            {thread.inProgress ? "live" : formatTime(thread.updatedAtIso)}
          </span>
        </button>
        <div className={styles.threadRowActions} aria-label="会话操作">
          <button
            className={styles.threadRowAction}
            type="button"
            aria-label={`停止 ${thread.title} 的所有后台终端`}
            title={
              thread.inProgress ? "停止所有后台终端" : "没有正在运行的后台"
            }
            disabled={!thread.inProgress}
            onClick={() => onStopThreadBackground(thread.id)}
          >
            <Square size={10} fill="currentColor" />
          </button>
          <button
            className={styles.threadRowAction}
            type="button"
            aria-label={thread.pinned ? "取消置顶对话" : "置顶对话"}
            title={thread.pinned ? "取消置顶对话" : "置顶对话"}
            onClick={() => onTogglePinThread(thread.id, !thread.pinned)}
          >
            {thread.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            className={styles.threadRowAction}
            type="button"
            aria-label="归档对话"
            title="归档对话"
            onClick={() => onArchiveThread(thread.id)}
          >
            <Archive size={14} />
          </button>
        </div>
      </div>
    );
  });

  if (!virtualize || !window) return <>{rows}</>;

  return (
    <div
      className={styles.virtualThreadList}
      data-testid={
        archived ? "archived-thread-list-window" : "thread-list-window"
      }
      ref={scrollerRef}
      style={{ height: window.viewportHeight }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className={styles.virtualThreadInner}
        style={{ height: window.totalHeight }}
      >
        <div
          className={styles.virtualThreadItems}
          style={{ transform: `translateY(${window.offsetTop}px)` }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}

function SidebarContent({
  threadList,
  archivedThreads,
  threadListLoading,
  hasMoreThreads,
  hasMoreArchivedThreads,
  loadingMoreThreads,
  loadingMoreArchivedThreads,
  selectedThreadId,
  selectedProjectId,
  onSelectThread,
  onSelectProject,
  onOpenSearch,
  onOpenSettings,
  auth,
  accountStatus,
  onCreateThread,
  onAddFavoriteProject,
  onLoadMoreThreads,
  onLoadMoreArchivedThreads,
  onRestoreThread,
  onTogglePinThread,
  onArchiveThread,
  onStopThreadBackground,
  onSignOut,
}: {
  threadList: ThreadList;
  archivedThreads: Thread[];
  threadListLoading: boolean;
  hasMoreThreads: boolean;
  hasMoreArchivedThreads: boolean;
  loadingMoreThreads: boolean;
  loadingMoreArchivedThreads: boolean;
  selectedThreadId: string;
  selectedProjectId: string | null;
  onSelectThread: (threadId: string) => void;
  onSelectProject: (projectId: string | null) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  auth: AuthStatus | null;
  accountStatus: AccountStatus | null;
  onCreateThread: (cwd?: string | null) => void;
  onAddFavoriteProject: () => void;
  onLoadMoreThreads: () => void;
  onLoadMoreArchivedThreads: () => void;
  onRestoreThread: (threadId: string) => void;
  onTogglePinThread: (threadId: string, pinned: boolean) => void;
  onArchiveThread: (threadId: string) => void;
  onStopThreadBackground: (threadId: string) => void;
  onSignOut: () => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  const [threadsExpanded, setThreadsExpanded] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedProject =
    selectedProjectId && selectedProjectId !== NO_PROJECT_FILTER_ID
      ? (threadList.projects.find(
          (project) => project.id === selectedProjectId,
        ) ?? null)
      : null;
  const selectedProjectCwd =
    selectedProject?.path ?? selectedProject?.id ?? null;
  const visibleProjects = normalizedQuery
    ? threadList.projects.filter((project) =>
        [project.name, project.path ?? project.id].some((value) =>
          value.toLocaleLowerCase().includes(normalizedQuery),
        ),
      )
    : threadList.projects;
  const renderedProjects = limitedRows(
    visibleProjects,
    projectsExpanded,
    Boolean(normalizedQuery),
  );
  const pinnedThreads = threadList.threads.filter((thread) => thread.pinned);
  const unpinnedThreads = threadList.threads.filter((thread) => !thread.pinned);
  const projectFilteredPinnedThreads = pinnedThreads.filter((thread) =>
    threadMatchesProject(thread, selectedProjectId),
  );
  const visiblePinnedThreads = normalizedQuery
    ? projectFilteredPinnedThreads.filter((thread) => {
        const project = projectForThread(thread, threadList.projects);
        return [thread.title, thread.path ?? "", project?.name ?? ""].some(
          (value) => value.toLocaleLowerCase().includes(normalizedQuery),
        );
      })
    : projectFilteredPinnedThreads;
  const renderedPinnedThreads = limitedRows(
    visiblePinnedThreads,
    pinnedExpanded,
    Boolean(normalizedQuery),
  );
  const projectFilteredThreads = unpinnedThreads.filter((thread) =>
    threadMatchesProject(thread, selectedProjectId),
  );
  const visibleThreads = normalizedQuery
    ? projectFilteredThreads.filter((thread) => {
        const project = projectForThread(thread, threadList.projects);
        return [thread.title, thread.path ?? "", project?.name ?? ""].some(
          (value) => value.toLocaleLowerCase().includes(normalizedQuery),
        );
      })
    : projectFilteredThreads;
  const renderedThreads = limitedRows(
    visibleThreads,
    threadsExpanded,
    Boolean(normalizedQuery),
  );
  const projectFilteredArchivedThreads = archivedThreads.filter((thread) =>
    threadMatchesProject(thread, selectedProjectId),
  );
  const visibleArchivedThreads = normalizedQuery
    ? projectFilteredArchivedThreads.filter((thread) =>
        [thread.title, thread.path ?? "", thread.projectId ?? ""].some(
          (value) => value.toLocaleLowerCase().includes(normalizedQuery),
        ),
      )
    : projectFilteredArchivedThreads;
  const renderedArchivedThreads = limitedRows(
    visibleArchivedThreads,
    archivedExpanded,
    Boolean(normalizedQuery),
  );
  const noProjectCount = threadList.threads.filter(
    (thread) => !thread.projectId,
  ).length;
  const loadedThreadLabel = threadListLoading
    ? "正在同步会话"
    : `${threadList.threads.length}${hasMoreThreads ? "+" : ""} 个同步会话`;

  return (
    <aside
      className={styles.sidebarSurface}
      aria-busy={threadListLoading}
      aria-label="项目和会话"
    >
      <nav className={styles.sidebarQuickNav} aria-label="主导航">
        <button
          className={styles.sidebarNavRow}
          type="button"
          onClick={() => onCreateThread(selectedProjectCwd)}
        >
          <SquarePen size={17} />
          <span>新对话</span>
        </button>
        <button
          className={styles.sidebarNavRow}
          type="button"
          aria-label="Search"
          onClick={onOpenSearch}
        >
          <Search size={17} />
          <span>搜索</span>
        </button>
        <button className={styles.sidebarNavRow} type="button" disabled>
          <Puzzle size={17} />
          <span>插件</span>
        </button>
        <button className={styles.sidebarNavRow} type="button" disabled>
          <History size={17} />
          <span>自动化</span>
        </button>
      </nav>

      <div className={styles.sidebarHeader}>
        <button className={styles.workspaceButton} type="button">
          <span className={styles.workspaceMark}>cw</span>
          <span>
            <span className={styles.workspaceName}>codex_web</span>
            <span className={styles.workspaceMeta}>{loadedThreadLabel}</span>
          </span>
          <ChevronDown size={16} />
        </button>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="新建会话"
          onClick={() => onCreateThread(selectedProjectCwd)}
        >
          <SquarePen size={17} />
        </button>
      </div>

      <label className={styles.searchBox}>
        <Search size={15} />
        <input
          type="search"
          placeholder="搜索项目、会话或文件"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {visiblePinnedThreads.length > 0 ? (
        <section className={styles.navSection}>
          <div className={styles.sectionHeader}>
            <span>置顶</span>
            <span>{visiblePinnedThreads.length}</span>
          </div>
          <ThreadRows
            threads={renderedPinnedThreads}
            projects={threadList.projects}
            selectedThreadId={selectedThreadId}
            onSelectThread={onSelectThread}
            onRestoreThread={onRestoreThread}
            onTogglePinThread={onTogglePinThread}
            onArchiveThread={onArchiveThread}
            onStopThreadBackground={onStopThreadBackground}
          />
          <ExpandRowsButton
            expanded={pinnedExpanded}
            hiddenCount={
              normalizedQuery
                ? 0
                : visiblePinnedThreads.length - COLLAPSED_SECTION_LIMIT
            }
            onToggle={() => setPinnedExpanded((value) => !value)}
          />
        </section>
      ) : null}

      <section className={styles.navSection}>
        <div className={styles.sectionHeader}>
          <span>项目</span>
          <button
            className={styles.tinyIconButton}
            type="button"
            aria-label="新增项目"
            onClick={onAddFavoriteProject}
          >
            <Plus size={14} />
          </button>
        </div>
        <button
          className={
            !selectedProjectId ? styles.projectRowActive : styles.projectRow
          }
          type="button"
          onClick={() => onSelectProject(null)}
        >
          <span className={styles.projectIcon}>
            <Home size={15} />
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>全部会话</span>
            <span className={styles.rowMeta}>
              {threadListLoading
                ? "正在同步会话"
                : `${threadList.threads.length} 个同步会话`}
            </span>
          </span>
          <ActivityDot active={!selectedProjectId} />
        </button>
        {renderedProjects.map((project) => (
          <button
            className={
              project.id === selectedProjectId
                ? styles.projectRowActive
                : styles.projectRow
            }
            key={project.id}
            type="button"
            aria-label={`选择项目 ${project.name}`}
            onClick={() => onSelectProject(project.id)}
          >
            <span className={styles.projectIcon}>
              <Folder size={15} />
            </span>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>{project.name}</span>
            </span>
            <ActivityDot active={project.id === selectedProjectId} />
          </button>
        ))}
        <ExpandRowsButton
          expanded={projectsExpanded}
          hiddenCount={
            normalizedQuery
              ? 0
              : visibleProjects.length - COLLAPSED_SECTION_LIMIT
          }
          onToggle={() => setProjectsExpanded((value) => !value)}
        />
        {noProjectCount > 0 ? (
          <button
            className={
              selectedProjectId === NO_PROJECT_FILTER_ID
                ? styles.projectRowActive
                : styles.projectRow
            }
            type="button"
            onClick={() => onSelectProject(NO_PROJECT_FILTER_ID)}
          >
            <span className={styles.projectIcon}>
              <MessageSquare size={15} />
            </span>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>无项目会话</span>
              <span className={styles.rowMeta}>
                {noProjectCount} 个全局会话
              </span>
            </span>
            <ActivityDot active={selectedProjectId === NO_PROJECT_FILTER_ID} />
          </button>
        ) : null}
      </section>

      <section className={styles.navSection}>
        <div className={styles.sectionHeader}>
          <span>会话</span>
          <span>
            {threadList.threads.length}
            {hasMoreThreads ? "+" : ""}
          </span>
        </div>
        <ThreadRows
          threads={renderedThreads}
          projects={threadList.projects}
          selectedThreadId={selectedThreadId}
          onSelectThread={onSelectThread}
          onRestoreThread={onRestoreThread}
          onTogglePinThread={onTogglePinThread}
          onArchiveThread={onArchiveThread}
          onStopThreadBackground={onStopThreadBackground}
        />
        <ExpandRowsButton
          expanded={threadsExpanded}
          hiddenCount={
            normalizedQuery
              ? 0
              : visibleThreads.length - COLLAPSED_SECTION_LIMIT
          }
          onToggle={() => setThreadsExpanded((value) => !value)}
        />
        {visibleThreads.length === 0 ? (
          <div className={styles.emptySidebar}>
            {threadListLoading ? "正在同步会话..." : "没有匹配的会话"}
          </div>
        ) : null}
        {hasMoreThreads ? (
          <button
            className={styles.loadMoreRow}
            type="button"
            disabled={loadingMoreThreads}
            onClick={onLoadMoreThreads}
          >
            {loadingMoreThreads ? "正在加载更多会话..." : "加载更多会话"}
          </button>
        ) : null}
      </section>

      <section className={styles.navSection}>
        <div className={styles.sectionHeader}>
          <span>归档</span>
          <span>
            {archivedThreads.length}
            {hasMoreArchivedThreads ? "+" : ""}
          </span>
        </div>
        <ThreadRows
          threads={renderedArchivedThreads}
          projects={threadList.projects}
          selectedThreadId={selectedThreadId}
          archived
          onSelectThread={onSelectThread}
          onRestoreThread={onRestoreThread}
          onTogglePinThread={onTogglePinThread}
          onArchiveThread={onArchiveThread}
          onStopThreadBackground={onStopThreadBackground}
        />
        <ExpandRowsButton
          expanded={archivedExpanded}
          hiddenCount={
            normalizedQuery
              ? 0
              : visibleArchivedThreads.length - COLLAPSED_SECTION_LIMIT
          }
          onToggle={() => setArchivedExpanded((value) => !value)}
        />
        {visibleArchivedThreads.length === 0 ? (
          <div className={styles.emptySidebar}>
            {threadListLoading ? "正在同步归档..." : "没有归档会话"}
          </div>
        ) : null}
        {hasMoreArchivedThreads ? (
          <button
            className={styles.loadMoreRow}
            type="button"
            disabled={loadingMoreArchivedThreads}
            onClick={onLoadMoreArchivedThreads}
          >
            {loadingMoreArchivedThreads
              ? "正在加载更多归档..."
              : "加载更多归档"}
          </button>
        ) : null}
      </section>

      <div className={styles.sidebarFooter}>
        <SettingsAccountMenu
          open={settingsMenuOpen}
          auth={auth}
          accountStatus={accountStatus}
          onOpenSettings={() => {
            setSettingsMenuOpen(false);
            onOpenSettings();
          }}
          onSignOut={() => {
            setSettingsMenuOpen(false);
            onSignOut();
          }}
        />
        <button
          className={styles.sidebarNavRow}
          type="button"
          aria-label="Settings menu"
          aria-expanded={settingsMenuOpen}
          onClick={() => setSettingsMenuOpen((value) => !value)}
        >
          <Settings size={17} />
          <span>设置</span>
        </button>
        <button className={styles.upgradeButton} type="button">
          升级
        </button>
      </div>
    </aside>
  );
}

export function DesktopSidebar({
  threadList,
  archivedThreads,
  threadListLoading,
  hasMoreThreads,
  hasMoreArchivedThreads,
  loadingMoreThreads,
  loadingMoreArchivedThreads,
  selectedThreadId,
  selectedProjectId,
  onSelectThread,
  onOpenDrawer,
  onOpenSearch,
  onOpenSettings,
  auth,
  accountStatus,
  onSelectProject,
  onCreateThread,
  onAddFavoriteProject,
  onLoadMoreThreads,
  onLoadMoreArchivedThreads,
  onRestoreThread,
  onTogglePinThread,
  onArchiveThread,
  onStopThreadBackground,
  onSignOut,
}: {
  threadList: ThreadList;
  archivedThreads: Thread[];
  threadListLoading: boolean;
  hasMoreThreads: boolean;
  hasMoreArchivedThreads: boolean;
  loadingMoreThreads: boolean;
  loadingMoreArchivedThreads: boolean;
  selectedThreadId: string;
  selectedProjectId: string | null;
  onSelectThread: (threadId: string) => void;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  auth: AuthStatus | null;
  accountStatus: AccountStatus | null;
  onSelectProject: (projectId: string | null) => void;
  onCreateThread: (cwd?: string | null) => void;
  onAddFavoriteProject: () => void;
  onLoadMoreThreads: () => void;
  onLoadMoreArchivedThreads: () => void;
  onRestoreThread: (threadId: string) => void;
  onTogglePinThread: (threadId: string, pinned: boolean) => void;
  onArchiveThread: (threadId: string) => void;
  onStopThreadBackground: (threadId: string) => void;
  onSignOut: () => void;
}): ReactElement {
  return (
    <div className={styles.desktopSidebar}>
      <SidebarContent
        threadList={threadList}
        archivedThreads={archivedThreads}
        threadListLoading={threadListLoading}
        hasMoreThreads={hasMoreThreads}
        hasMoreArchivedThreads={hasMoreArchivedThreads}
        loadingMoreThreads={loadingMoreThreads}
        loadingMoreArchivedThreads={loadingMoreArchivedThreads}
        selectedThreadId={selectedThreadId}
        selectedProjectId={selectedProjectId}
        onSelectThread={onSelectThread}
        onSelectProject={onSelectProject}
        onOpenSearch={onOpenSearch}
        onOpenSettings={onOpenSettings}
        auth={auth}
        accountStatus={accountStatus}
        onCreateThread={onCreateThread}
        onAddFavoriteProject={onAddFavoriteProject}
        onLoadMoreThreads={onLoadMoreThreads}
        onLoadMoreArchivedThreads={onLoadMoreArchivedThreads}
        onRestoreThread={onRestoreThread}
        onTogglePinThread={onTogglePinThread}
        onArchiveThread={onArchiveThread}
        onStopThreadBackground={onStopThreadBackground}
        onSignOut={onSignOut}
      />
    </div>
  );
}

export function MobileDrawer({
  open,
  onClose,
  onOpenSearch,
  onOpenSettings,
  auth,
  accountStatus,
  threadList,
  archivedThreads,
  threadListLoading,
  hasMoreThreads,
  hasMoreArchivedThreads,
  loadingMoreThreads,
  loadingMoreArchivedThreads,
  selectedThreadId,
  selectedProjectId,
  onSelectThread,
  onSelectProject,
  onCreateThread,
  onAddFavoriteProject,
  onLoadMoreThreads,
  onLoadMoreArchivedThreads,
  onRestoreThread,
  onTogglePinThread,
  onArchiveThread,
  onStopThreadBackground,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  auth: AuthStatus | null;
  accountStatus: AccountStatus | null;
  threadList: ThreadList;
  archivedThreads: Thread[];
  threadListLoading: boolean;
  hasMoreThreads: boolean;
  hasMoreArchivedThreads: boolean;
  loadingMoreThreads: boolean;
  loadingMoreArchivedThreads: boolean;
  selectedThreadId: string;
  selectedProjectId: string | null;
  onSelectThread: (threadId: string) => void;
  onSelectProject: (projectId: string | null) => void;
  onCreateThread: (cwd?: string | null) => void;
  onAddFavoriteProject: () => void;
  onLoadMoreThreads: () => void;
  onLoadMoreArchivedThreads: () => void;
  onRestoreThread: (threadId: string) => void;
  onTogglePinThread: (threadId: string, pinned: boolean) => void;
  onArchiveThread: (threadId: string) => void;
  onStopThreadBackground: (threadId: string) => void;
  onSignOut: () => void;
}): ReactElement | null {
  if (!open) return null;
  return (
    <div className={styles.drawerLayer}>
      <button
        className={styles.drawerScrim}
        type="button"
        aria-label="关闭导航"
        onClick={onClose}
      />
      <div className={styles.drawerPanel}>
        <div className={styles.drawerTopbar}>
          <span>导航</span>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <SidebarContent
          threadList={threadList}
          archivedThreads={archivedThreads}
          threadListLoading={threadListLoading}
          hasMoreThreads={hasMoreThreads}
          hasMoreArchivedThreads={hasMoreArchivedThreads}
          loadingMoreThreads={loadingMoreThreads}
          loadingMoreArchivedThreads={loadingMoreArchivedThreads}
        selectedThreadId={selectedThreadId}
        selectedProjectId={selectedProjectId}
        onSelectThread={(threadId) => {
            onSelectThread(threadId);
            onClose();
          }}
          onSelectProject={(projectId) => {
            onSelectProject(projectId);
            onClose();
          }}
          onOpenSearch={onOpenSearch}
          onOpenSettings={onOpenSettings}
          auth={auth}
          accountStatus={accountStatus}
        onCreateThread={(cwd) => {
            onCreateThread(cwd);
            onClose();
          }}
          onAddFavoriteProject={onAddFavoriteProject}
          onLoadMoreThreads={onLoadMoreThreads}
          onLoadMoreArchivedThreads={onLoadMoreArchivedThreads}
          onRestoreThread={(threadId) => {
            onRestoreThread(threadId);
            onClose();
          }}
          onTogglePinThread={onTogglePinThread}
          onArchiveThread={(threadId) => {
            onArchiveThread(threadId);
            onClose();
          }}
          onStopThreadBackground={onStopThreadBackground}
          onSignOut={() => {
            onSignOut();
            onClose();
          }}
        />
      </div>
    </div>
  );
}
