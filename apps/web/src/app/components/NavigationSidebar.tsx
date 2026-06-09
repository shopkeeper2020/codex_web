import {
  Archive,
  ChevronDown,
  ChevronRight,
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
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from "react";
import { useEffect, useRef, useState } from "react";
import type {
  AccountStatus,
  AuthStatus,
  Project,
  Thread,
  ThreadList,
} from "../../api";
import styles from "../App.module.css";
import { displayTextFromReferencedPrompt } from "../textReferences";
import {
  calculateVirtualThreadWindow,
  initialThreadScrollTop,
  shouldVirtualizeThreadRows,
  THREAD_ROW_HEIGHT_PX,
  THREAD_ROW_MAX_VIEWPORT_PX,
} from "../virtualThreadRows";

export const NO_PROJECT_FILTER_ID = "__codex_web_no_project__";
const COLLAPSED_SECTION_LIMIT = 5;
const THREAD_ACTION_LONG_PRESS_MS = 520;

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

function projectRowClass(input: {
  filterActive: boolean;
  currentThreadProject: boolean;
}): string {
  const classes = [styles.projectRowShell];
  if (input.filterActive) classes.push(styles.projectRowShellActive);
  if (!input.filterActive && input.currentThreadProject)
    classes.push(styles.projectRowShellCurrent);
  return classes.filter(Boolean).join(" ");
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

function limitedRows<T>(
  items: T[],
  expanded: boolean,
  searching: boolean,
): T[] {
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
    <button
      className={styles.expandRowsButton}
      type="button"
      onClick={onToggle}
    >
      {expanded ? "收起显示" : "展开显示"}
      <span>{expanded ? "" : `+${hiddenCount}`}</span>
    </button>
  );
}

function ProjectRow({
  active,
  current,
  icon,
  title,
  meta,
  activityActive,
  selectLabel,
  rowTitle,
  onSelect,
  onCreateThread,
  createThreadLabel,
}: {
  active: boolean;
  current: boolean;
  icon: ReactElement;
  title: string;
  meta?: string;
  activityActive?: boolean;
  selectLabel: string;
  rowTitle?: string;
  onSelect: () => void;
  onCreateThread?: () => void;
  createThreadLabel?: string;
}): ReactElement {
  const newThreadLabel = createThreadLabel ?? `在 ${title} 中开始新对话`;
  const className = [
    projectRowClass({
      filterActive: active,
      currentThreadProject: current,
    }),
    onCreateThread ? styles.projectRowWithAction : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className}>
      <button
        className={styles.projectRowMain}
        type="button"
        aria-label={selectLabel}
        title={rowTitle}
        onClick={onSelect}
      >
        <span className={styles.projectIcon}>{icon}</span>
        <span className={styles.rowText}>
          <span className={styles.rowTitle}>{title}</span>
          {meta ? <span className={styles.rowMeta}>{meta}</span> : null}
        </span>
        <ActivityDot active={activityActive} />
      </button>
      {onCreateThread ? (
        <button
          className={styles.projectRowAction}
          type="button"
          aria-label={newThreadLabel}
          title={newThreadLabel}
          onClick={(event) => {
            event.stopPropagation();
            onCreateThread();
          }}
        >
          <SquarePen size={14} />
        </button>
      ) : null}
    </div>
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
    <div
      className={styles.settingsAccountMenu}
      role="menu"
      aria-label="账户与设置"
    >
      <div className={styles.settingsAccountIdentity}>
        <CircleUser size={16} />
        <span>{accountLabel}</span>
      </div>
      <button
        className={styles.settingsMenuItem}
        type="button"
        role="menuitem"
        disabled
      >
        <Settings size={15} />
        <span>个人账户</span>
      </button>
      <button
        className={styles.settingsMenuItem}
        type="button"
        role="menuitem"
        disabled
      >
        <Sparkles size={15} />
        <span>升级以获享更高限额</span>
        <ExternalLink size={13} />
      </button>
      <button
        className={styles.settingsMenuItem}
        type="button"
        role="menuitem"
        onClick={onOpenSettings}
      >
        <Settings size={15} />
        <span>设置</span>
      </button>
      <button
        className={styles.settingsMenuItem}
        type="button"
        role="menuitem"
        disabled
      >
        <Gauge size={15} />
        <span>剩余用量</span>
      </button>
      <button
        className={styles.settingsMenuItem}
        type="button"
        role="menuitem"
        onClick={onSignOut}
      >
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
  const [actionMenuThreadId, setActionMenuThreadId] = useState<string | null>(
    null,
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  useEffect(() => {
    if (!virtualize) return;
    const nextScrollTop = initialThreadScrollTop(selectedIndex, threads.length);
    setScrollTop(nextScrollTop);
    if (scrollerRef.current) scrollerRef.current.scrollTop = nextScrollTop;
  }, [selectedIndex, threads.length, virtualize]);

  useEffect(() => clearLongPressTimer, []);

  useEffect(() => {
    if (!actionMenuThreadId) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && actionMenuRef.current?.contains(target))
        return;
      setActionMenuThreadId(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionMenuThreadId(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionMenuThreadId]);

  function openThreadActionMenu(threadId: string): void {
    clearLongPressTimer();
    setActionMenuThreadId(threadId);
  }

  function handleThreadPointerDown(
    threadId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    if (event.pointerType === "mouse") return;
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      openThreadActionMenu(threadId);
    }, THREAD_ACTION_LONG_PRESS_MS);
  }

  function handleThreadPointerEnd(): void {
    clearLongPressTimer();
  }

  function handleThreadClick(threadId: string): void {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    setActionMenuThreadId(null);
    onSelectThread(threadId);
  }

  function handleThreadContextMenu(
    threadId: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    longPressTriggeredRef.current = false;
    openThreadActionMenu(threadId);
  }

  function handleThreadKeyDown(
    threadId: string,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ): void {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;
    event.preventDefault();
    openThreadActionMenu(threadId);
  }

  function runThreadAction(action: () => void): void {
    setActionMenuThreadId(null);
    action();
  }

  const virtualWindow = virtualize
    ? calculateVirtualThreadWindow({
        itemCount: threads.length,
        scrollTop,
        viewportHeight,
      })
    : null;
  const renderedThreads = virtualWindow
    ? threads.slice(virtualWindow.startIndex, virtualWindow.endIndex)
    : threads;

  const rows = renderedThreads.map((thread) => {
    const displayTitle = displayTextFromReferencedPrompt(thread.title);
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
            <span className={styles.rowTitle}>{displayTitle}</span>
            <span className={styles.rowMeta}>
              点击恢复 · {formatTime(thread.updatedAtIso)}
            </span>
          </span>
          <span className={styles.threadTime}>restore</span>
        </button>
      );
    }

    const project = projectForThread(thread, projects);
    const actionMenuOpen = actionMenuThreadId === thread.id;
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
          aria-haspopup="menu"
          aria-expanded={actionMenuOpen}
          onClick={() => handleThreadClick(thread.id)}
          onContextMenu={(event) => handleThreadContextMenu(thread.id, event)}
          onKeyDown={(event) => handleThreadKeyDown(thread.id, event)}
          onPointerDown={(event) => handleThreadPointerDown(thread.id, event)}
          onPointerUp={handleThreadPointerEnd}
          onPointerCancel={handleThreadPointerEnd}
          onPointerLeave={handleThreadPointerEnd}
        >
          {thread.pinned ? (
            <Pin
              className={styles.threadPinIcon}
              size={15}
              fill="currentColor"
            />
          ) : (
            <MessageSquare size={15} />
          )}
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>{displayTitle}</span>
            <span className={styles.rowMeta}>
              {project?.name ?? thread.path ?? "无项目会话"}
            </span>
          </span>
          <span className={styles.threadTime}>
            {thread.inProgress ? "live" : formatTime(thread.updatedAtIso)}
          </span>
        </button>
        {actionMenuOpen ? (
          <div
            className={styles.threadActionMenu}
            ref={actionMenuRef}
            role="menu"
            aria-label={`${displayTitle} 的会话操作`}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              className={styles.threadActionMenuItem}
              type="button"
              role="menuitem"
              disabled={!thread.inProgress}
              title={
                thread.inProgress ? "停止后台终端" : "没有正在运行的后台终端"
              }
              onClick={() =>
                runThreadAction(() => onStopThreadBackground(thread.id))
              }
            >
              <Square size={10} fill="currentColor" />
              <span>停止后台终端</span>
            </button>
            <button
              className={styles.threadActionMenuItem}
              type="button"
              role="menuitem"
              title={thread.pinned ? "取消置顶对话" : "置顶对话"}
              onClick={() =>
                runThreadAction(() =>
                  onTogglePinThread(thread.id, !thread.pinned),
                )
              }
            >
              {thread.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              <span>{thread.pinned ? "取消置顶对话" : "置顶对话"}</span>
            </button>
            <button
              className={styles.threadActionMenuItem}
              type="button"
              role="menuitem"
              title="归档对话"
              onClick={() => runThreadAction(() => onArchiveThread(thread.id))}
            >
              <Archive size={14} />
              <span>归档对话</span>
            </button>
          </div>
        ) : null}
      </div>
    );
  });

  if (!virtualize || !virtualWindow) return <>{rows}</>;

  return (
    <div
      className={styles.virtualThreadList}
      data-testid={
        archived ? "archived-thread-list-window" : "thread-list-window"
      }
      ref={scrollerRef}
      style={{ height: virtualWindow.viewportHeight }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className={styles.virtualThreadInner}
        style={{ height: virtualWindow.totalHeight }}
      >
        <div
          className={styles.virtualThreadItems}
          style={{ transform: `translateY(${virtualWindow.offsetTop}px)` }}
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
  selectedThreadProjectId,
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
  selectedThreadProjectId: string | null;
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
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  const [threadsExpanded, setThreadsExpanded] = useState(false);
  const [archivedSectionOpen, setArchivedSectionOpen] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const selectedProject =
    selectedProjectId && selectedProjectId !== NO_PROJECT_FILTER_ID
      ? (threadList.projects.find(
          (project) => project.id === selectedProjectId,
        ) ?? null)
      : null;
  const selectedProjectCwd =
    selectedProject?.path ?? selectedProject?.id ?? null;
  const createThreadCwd =
    selectedProjectId === NO_PROJECT_FILTER_ID
      ? null
      : (selectedProjectCwd ?? undefined);
  const visibleProjects = threadList.projects;
  const renderedProjects = limitedRows(visibleProjects, projectsExpanded, false);
  const pinnedThreads = threadList.threads.filter((thread) => thread.pinned);
  const unpinnedThreads = threadList.threads.filter((thread) => !thread.pinned);
  const projectFilteredPinnedThreads = pinnedThreads.filter((thread) =>
    threadMatchesProject(thread, selectedProjectId),
  );
  const visiblePinnedThreads = projectFilteredPinnedThreads;
  const renderedPinnedThreads = limitedRows(
    visiblePinnedThreads,
    pinnedExpanded,
    false,
  );
  const projectFilteredThreads = unpinnedThreads.filter((thread) =>
    threadMatchesProject(thread, selectedProjectId),
  );
  const visibleThreads = projectFilteredThreads;
  const renderedThreads = limitedRows(visibleThreads, threadsExpanded, false);
  const projectFilteredArchivedThreads = archivedThreads.filter((thread) =>
    threadMatchesProject(thread, selectedProjectId),
  );
  const visibleArchivedThreads = projectFilteredArchivedThreads;
  const showArchivedContents = archivedSectionOpen;
  const renderedArchivedThreads = limitedRows(
    showArchivedContents ? visibleArchivedThreads : [],
    archivedExpanded,
    false,
  );
  const noProjectCount = threadList.threads.filter(
    (thread) => !thread.projectId,
  ).length;
  return (
    <aside
      className={styles.sidebarSurface}
      aria-busy={threadListLoading}
      aria-label="项目和会话"
    >
      <div className={styles.sidebarScrollArea}>
        <nav className={styles.sidebarQuickNav} aria-label="主导航">
          <button
            className={styles.sidebarNavRow}
            type="button"
            onClick={() => onCreateThread(createThreadCwd)}
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
              hiddenCount={visiblePinnedThreads.length - COLLAPSED_SECTION_LIMIT}
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
              title="新增项目"
              onClick={onAddFavoriteProject}
            >
              <Plus size={14} />
            </button>
          </div>
          <ProjectRow
            active={!selectedProjectId}
            current={false}
            icon={<Home size={15} />}
            title="全部会话"
            meta={
              threadListLoading
                ? "正在同步会话"
                : `${threadList.threads.length} 个同步会话`
            }
            activityActive={false}
            selectLabel="选择全部会话"
            onSelect={() => onSelectProject(null)}
          />
          {renderedProjects.map((project) => {
            const currentThreadProject = project.id === selectedThreadProjectId;
            const projectCwd = project.path ?? project.id;
            return (
              <ProjectRow
                key={project.id}
                active={project.id === selectedProjectId}
                current={currentThreadProject}
                icon={<Folder size={15} />}
                title={project.name}
                activityActive={currentThreadProject}
                selectLabel={`选择项目 ${project.name}`}
                rowTitle={currentThreadProject ? "当前会话所属项目" : undefined}
                onSelect={() => onSelectProject(project.id)}
                onCreateThread={() => onCreateThread(projectCwd)}
                createThreadLabel={`在 ${project.name} 中开始新对话`}
              />
            );
          })}
          <ExpandRowsButton
            expanded={projectsExpanded}
            hiddenCount={visibleProjects.length - COLLAPSED_SECTION_LIMIT}
            onToggle={() => setProjectsExpanded((value) => !value)}
          />
          {noProjectCount > 0 ? (
            <ProjectRow
              active={selectedProjectId === NO_PROJECT_FILTER_ID}
              current={selectedThreadProjectId === NO_PROJECT_FILTER_ID}
              icon={<MessageSquare size={15} />}
              title="无项目会话"
              meta={`${noProjectCount} 个全局会话`}
              activityActive={selectedThreadProjectId === NO_PROJECT_FILTER_ID}
              selectLabel="选择无项目会话"
              rowTitle={
                selectedThreadProjectId === NO_PROJECT_FILTER_ID
                  ? "当前会话无项目"
                  : undefined
              }
              onSelect={() => onSelectProject(NO_PROJECT_FILTER_ID)}
              onCreateThread={() => onCreateThread(null)}
              createThreadLabel="开始无项目新对话"
            />
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
            hiddenCount={visibleThreads.length - COLLAPSED_SECTION_LIMIT}
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
          <button
            className={styles.collapsibleSectionHeader}
            type="button"
            aria-expanded={showArchivedContents}
            onClick={() => {
              setArchivedSectionOpen((value) => !value);
              setArchivedExpanded(false);
            }}
          >
            <span className={styles.collapsibleSectionTitle}>
              {showArchivedContents ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <span>归档</span>
            </span>
            <span>
              {archivedThreads.length}
              {hasMoreArchivedThreads ? "+" : ""}
            </span>
          </button>
          {showArchivedContents ? (
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
          ) : null}
          {showArchivedContents ? (
            <ExpandRowsButton
              expanded={archivedExpanded}
              hiddenCount={
                visibleArchivedThreads.length - COLLAPSED_SECTION_LIMIT
              }
              onToggle={() => setArchivedExpanded((value) => !value)}
            />
          ) : null}
          {showArchivedContents && visibleArchivedThreads.length === 0 ? (
            <div className={styles.emptySidebar}>
              {threadListLoading ? "正在同步归档..." : "没有归档会话"}
            </div>
          ) : null}
          {showArchivedContents && hasMoreArchivedThreads ? (
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
      </div>

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
  selectedThreadProjectId,
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
  selectedThreadProjectId: string | null;
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
        selectedThreadProjectId={selectedThreadProjectId}
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
  selectedThreadProjectId,
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
  selectedThreadProjectId: string | null;
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
          selectedThreadProjectId={selectedThreadProjectId}
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
