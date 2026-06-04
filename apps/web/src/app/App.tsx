import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { logout } from "../api";
import styles from "./App.module.css";
import { ChatMain } from "./components/ChatMain";
import { Composer, type SendOptions } from "./components/Composer";
import { DebugPage } from "./components/DebugPage";
import { LoginGate } from "./components/LoginGate";
import {
  DesktopSidebar,
  MobileDrawer,
  NO_PROJECT_FILTER_ID,
} from "./components/NavigationSidebar";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsDiagnosticsPanel } from "./components/SettingsDiagnosticsPanel";
import { Header } from "./components/ThreadHeader";
import { useAuthGate } from "./hooks/useAuthGate";
import { useRuntimeData } from "./hooks/useRuntimeData";
import {
  ROUTE_CHANGE_EVENT,
  type AppRoute,
  readAppRouteFromLocation,
  replaceAppPath,
  replaceRoute,
} from "./routes";

type DraftThread = {
  cwd: string | null;
  key: number;
};

const DESKTOP_LEFT_SIDEBAR_WIDTH = 288;
const MOBILE_LAYOUT_WIDTH = 980;
const RIGHT_RAIL_MIN_MAIN_WIDTH = 920;

function readLayoutViewportWidth(): number {
  if (typeof window === "undefined") return Number.POSITIVE_INFINITY;
  return window.visualViewport?.width ?? window.innerWidth;
}

function projectDisplayName(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

export function App(): ReactElement {
  const authGate = useAuthGate();
  const {
    health,
    config,
    ipc,
    appServer,
    accountStatus,
    protocolCompatibility,
    runtimeOptions,
    threadList,
    archivedThreads,
    threadListLoading,
    hasMoreThreads,
    hasMoreArchivedThreads,
    loadingMoreThreads,
    loadingMoreArchivedThreads,
    selectedThreadId,
    selectedThread,
    threadDetail,
    activeTurnId,
    approvals,
    detailLoading,
    sending,
    error,
    realtimeEvents,
    selectThread,
    refreshRuntimeStatus,
    applyConfig,
    loadMoreThreads,
    loadMoreArchivedThreads,
    renameSelectedThread,
    archiveSelectedThread,
    archiveThreadById,
    setThreadPinned,
    stopThreadBackgroundById,
    restoreArchivedThread,
    addFavoriteProjectFromPrompt,
    interruptSelectedTurn,
    compactSelectedThread,
    forkThreadById,
    setThreadGoalById,
    clearThreadGoalById,
    decidePendingApproval,
    sendDraftMessage,
    sendMessage,
    queuedMessages,
    removeQueuedMessage,
    steerQueuedMessage,
    sendSideConversationMessage,
    createSideConversationForSelectedThread,
    closeSideConversationForSelectedThread,
  } = useRuntimeData(authGate.auth?.authenticated === true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [appRoute, setAppRoute] = useState<AppRoute>(() =>
    readAppRouteFromLocation(),
  );
  const [settingsOpen, setSettingsOpen] = useState(
    () => readAppRouteFromLocation() === "settings",
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [pinnedSummaryOpen, setPinnedSummaryOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [bottomTerminalOpen] = useState(false);
  const [draftThread, setDraftThread] = useState<DraftThread | null>(null);
  const [layoutViewportWidth, setLayoutViewportWidth] = useState(
    readLayoutViewportWidth,
  );
  const [manualRightRailOpen, setManualRightRailOpen] = useState<
    "summary" | "sidebar" | null
  >(null);
  const pinnedSummaryBeforeRightSidebarRef = useRef<boolean | null>(null);
  const draftThreadCounterRef = useRef(1);
  const leftSidebarWidth =
    layoutViewportWidth > MOBILE_LAYOUT_WIDTH && !desktopSidebarCollapsed
      ? DESKTOP_LEFT_SIDEBAR_WIDTH
      : 0;
  const mainPaneWidth = Math.max(0, layoutViewportWidth - leftSidebarWidth);
  const rightRailAutoCollapsed = mainPaneWidth < RIGHT_RAIL_MIN_MAIN_WIDTH;
  const pinnedSummaryVisible =
    pinnedSummaryOpen &&
    (!rightRailAutoCollapsed || manualRightRailOpen === "summary");
  const rightSidebarVisible =
    rightSidebarOpen &&
    (!rightRailAutoCollapsed || manualRightRailOpen === "sidebar");

  useEffect(() => {
    const syncViewportWidth = () =>
      setLayoutViewportWidth(readLayoutViewportWidth());
    syncViewportWidth();
    window.addEventListener("resize", syncViewportWidth);
    window.visualViewport?.addEventListener("resize", syncViewportWidth);
    return () => {
      window.removeEventListener("resize", syncViewportWidth);
      window.visualViewport?.removeEventListener("resize", syncViewportWidth);
    };
  }, []);

  useEffect(() => {
    if (!selectedProjectId || selectedProjectId === NO_PROJECT_FILTER_ID)
      return;
    if (
      !threadList.projects.some((project) => project.id === selectedProjectId)
    )
      setSelectedProjectId(null);
  }, [selectedProjectId, threadList.projects]);

  useEffect(() => {
    const handleRouteChange = () => {
      const nextRoute = readAppRouteFromLocation();
      setAppRoute(nextRoute);
      setSettingsOpen(nextRoute === "settings");
    };
    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener(ROUTE_CHANGE_EVENT, handleRouteChange);
    return () => {
      window.removeEventListener("popstate", handleRouteChange);
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener(ROUTE_CHANGE_EVENT, handleRouteChange);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "k"
      ) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    setAppRoute("settings");
    replaceAppPath("/settings");
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    replaceRoute(draftThread ? "" : selectedThreadId);
  }, [draftThread, selectedThreadId]);

  const signOut = useCallback(() => {
    void logout().finally(() => window.location.reload());
  }, []);

  const leaveDebug = useCallback(() => {
    replaceRoute(draftThread ? "" : selectedThreadId);
  }, [draftThread, selectedThreadId]);
  const toggleDesktopSidebar = useCallback(() => {
    setDesktopSidebarCollapsed((collapsed) => !collapsed);
  }, []);

  const openRightSidebar = useCallback(() => {
    setManualRightRailOpen("sidebar");
    setPinnedSummaryOpen((open) => {
      if (
        !rightSidebarOpen &&
        pinnedSummaryBeforeRightSidebarRef.current === null
      ) {
        pinnedSummaryBeforeRightSidebarRef.current = open;
      }
      return false;
    });
    setRightSidebarOpen(true);
  }, [rightSidebarOpen]);

  const closeRightSidebar = useCallback(() => {
    setManualRightRailOpen(null);
    setRightSidebarOpen(false);
    const restorePinnedSummary = pinnedSummaryBeforeRightSidebarRef.current;
    pinnedSummaryBeforeRightSidebarRef.current = null;
    if (restorePinnedSummary !== null) {
      setPinnedSummaryOpen(restorePinnedSummary);
    }
  }, []);

  const togglePinnedSummary = useCallback(() => {
    if (rightSidebarOpen) {
      pinnedSummaryBeforeRightSidebarRef.current = null;
      setManualRightRailOpen(rightRailAutoCollapsed ? "summary" : null);
      setRightSidebarOpen(false);
      setPinnedSummaryOpen(true);
      return;
    }

    if (pinnedSummaryVisible) {
      setManualRightRailOpen(null);
      setPinnedSummaryOpen(false);
      return;
    }

    setManualRightRailOpen(rightRailAutoCollapsed ? "summary" : null);
    setPinnedSummaryOpen(true);
  }, [pinnedSummaryVisible, rightRailAutoCollapsed, rightSidebarOpen]);

  const toggleRightSidebar = useCallback(() => {
    if (rightSidebarVisible) {
      closeRightSidebar();
      return;
    }
    openRightSidebar();
  }, [closeRightSidebar, openRightSidebar, rightSidebarVisible]);

  const selectedProject =
    selectedProjectId && selectedProjectId !== NO_PROJECT_FILTER_ID
      ? (threadList.projects.find(
          (project) => project.id === selectedProjectId,
        ) ?? null)
      : null;
  const selectedProjectCwd =
    selectedProject?.path ?? selectedProject?.id ?? null;
  const fallbackDraftCwd =
    selectedProjectCwd ??
    selectedThread?.projectId ??
    selectedThread?.path ??
    threadList.projects[0]?.path ??
    null;
  const openThreadDraft = useCallback(
    (cwd?: string | null) => {
      const nextCwd = cwd === undefined ? fallbackDraftCwd : cwd;
      setDraftThread({
        cwd: nextCwd ?? null,
        key: draftThreadCounterRef.current++,
      });
      pinnedSummaryBeforeRightSidebarRef.current = null;
      setManualRightRailOpen(null);
      setPinnedSummaryOpen(false);
      setRightSidebarOpen(false);
      replaceRoute("");
    },
    [fallbackDraftCwd],
  );
  const selectSyncedThread = useCallback(
    (threadId: string) => {
      setDraftThread(null);
      selectThread(threadId);
    },
    [selectThread],
  );
  const restoreSyncedThread = useCallback(
    async (threadId: string) => {
      setDraftThread(null);
      await restoreArchivedThread(threadId);
    },
    [restoreArchivedThread],
  );
  const sendDraftThreadMessage = useCallback(
    async (
      text: string,
      attachmentIds: string[] = [],
      options: SendOptions = {},
    ) => {
      if (!draftThread) return;
      const createdThreadId = await sendDraftMessage(
        draftThread.cwd,
        text,
        attachmentIds,
        { ...options, cwd: draftThread.cwd },
      );
      if (createdThreadId) setDraftThread(null);
    },
    [draftThread, sendDraftMessage],
  );
  const selectDraftProject = useCallback((cwd: string | null) => {
    setDraftThread((current) => (current ? { ...current, cwd } : current));
  }, []);
  const draftProjectName = draftThread?.cwd
    ? (threadList.projects.find(
        (project) =>
          project.path === draftThread.cwd || project.id === draftThread.cwd,
      )?.name ?? projectDisplayName(draftThread.cwd))
    : null;
  const visibleSelectedThread = draftThread ? null : selectedThread;
  const visibleSelectedThreadId = draftThread ? "" : selectedThreadId;
  const visibleSelectedThreadProjectId = visibleSelectedThread
    ? (visibleSelectedThread.projectId ?? NO_PROJECT_FILTER_ID)
    : null;
  const visiblePinnedSummaryOpen = draftThread ? false : pinnedSummaryVisible;
  const visibleRightSidebarOpen = draftThread ? false : rightSidebarVisible;
  const visibleBottomTerminalOpen = draftThread ? false : bottomTerminalOpen;
  const appClassName = [
    styles.app,
    desktopSidebarCollapsed ? styles.appSidebarCollapsed : "",
    appRoute === "debug" ? styles.appDebug : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (authGate.checking && !authGate.auth) {
    return <LoginGate checking error="" onLogin={authGate.loginWithPassword} />;
  }

  if (!authGate.auth || !authGate.auth.authenticated) {
    return (
      <LoginGate
        checking={authGate.checking}
        error={authGate.error}
        onLogin={authGate.loginWithPassword}
      />
    );
  }

  return (
    <div className={appClassName}>
      {appRoute === "debug" ? null : (
        <Header
          health={health}
          ipc={ipc}
          appServer={appServer}
          selectedThread={visibleSelectedThread}
          draftProjectName={draftThread ? draftProjectName : undefined}
          sidebarCollapsed={desktopSidebarCollapsed}
          onToggleSidebar={toggleDesktopSidebar}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSettings={openSettings}
          onRenameThread={() => void renameSelectedThread()}
          onArchiveThread={() => void archiveSelectedThread()}
          onInterruptTurn={() => void interruptSelectedTurn()}
          pinnedSummaryOpen={visiblePinnedSummaryOpen}
          rightSidebarOpen={visibleRightSidebarOpen}
          bottomTerminalOpen={visibleBottomTerminalOpen}
          onTogglePinnedSummary={
            draftThread ? () => undefined : togglePinnedSummary
          }
          onToggleRightSidebar={
            draftThread ? () => undefined : toggleRightSidebar
          }
          onToggleBottomTerminal={() => undefined}
        />
      )}
      {desktopSidebarCollapsed ? null : (
        <DesktopSidebar
          threadList={threadList}
          archivedThreads={archivedThreads}
          threadListLoading={threadListLoading}
          hasMoreThreads={hasMoreThreads}
          hasMoreArchivedThreads={hasMoreArchivedThreads}
          loadingMoreThreads={loadingMoreThreads}
          loadingMoreArchivedThreads={loadingMoreArchivedThreads}
          selectedThreadId={visibleSelectedThreadId}
          selectedProjectId={selectedProjectId}
          selectedThreadProjectId={visibleSelectedThreadProjectId}
          onSelectThread={selectSyncedThread}
          onSelectProject={setSelectedProjectId}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSettings={openSettings}
          auth={authGate.auth}
          accountStatus={accountStatus}
          onCreateThread={openThreadDraft}
          onAddFavoriteProject={() => void addFavoriteProjectFromPrompt()}
          onLoadMoreThreads={() => void loadMoreThreads()}
          onLoadMoreArchivedThreads={() => void loadMoreArchivedThreads()}
          onRestoreThread={(threadId) => void restoreSyncedThread(threadId)}
          onTogglePinThread={(threadId, pinned) =>
            void setThreadPinned(threadId, pinned)
          }
          onArchiveThread={(threadId) => void archiveThreadById(threadId)}
          onStopThreadBackground={(threadId) =>
            void stopThreadBackgroundById(threadId)
          }
          onSignOut={signOut}
        />
      )}
      <main
        className={`${styles.main} ${appRoute === "debug" ? styles.mainDebug : ""}`}
      >
        {appRoute === "debug" ? (
          <DebugPage onBack={leaveDebug} />
        ) : (
          <ChatMain
            config={config}
            ipc={ipc}
            appServer={appServer}
            threadList={threadList}
            threadListLoading={threadListLoading}
            selectedThread={visibleSelectedThread}
            draftThread={
              draftThread
                ? { cwd: draftThread.cwd, projectName: draftProjectName }
                : null
            }
            threadDetail={draftThread ? null : threadDetail}
            approvals={draftThread ? [] : approvals}
            detailLoading={draftThread ? false : detailLoading}
            realtimeEvents={realtimeEvents}
            runtimeOptions={runtimeOptions}
            error={error}
            onDecideApproval={decidePendingApproval}
            queuedMessages={draftThread ? [] : queuedMessages}
            onRemoveQueuedMessage={removeQueuedMessage}
            onSteerQueuedMessage={steerQueuedMessage}
            onSetThreadGoal={setThreadGoalById}
            onClearThreadGoal={clearThreadGoalById}
            onForkThread={forkThreadById}
            onSelectThread={selectThread}
            pinnedSummaryOpen={visiblePinnedSummaryOpen}
            rightSidebarOpen={visibleRightSidebarOpen}
            bottomTerminalOpen={visibleBottomTerminalOpen}
            onOpenRightSidebar={
              draftThread ? () => undefined : openRightSidebar
            }
            onSendSideChat={sendSideConversationMessage}
            onCreateSideChat={
              draftThread
                ? async () => null
                : createSideConversationForSelectedThread
            }
            onCloseSideChat={
              draftThread
                ? async () => undefined
                : closeSideConversationForSelectedThread
            }
            composer={
              <Composer
                threadId={
                  draftThread ? `draft:${draftThread.key}` : selectedThreadId
                }
                cwd={
                  draftThread
                    ? draftThread.cwd
                    : (selectedThread?.projectId ??
                      selectedThread?.path ??
                      null)
                }
                projects={threadList.projects}
                onSelectProject={draftThread ? selectDraftProject : undefined}
                showContextControls={Boolean(draftThread)}
                activeTurnId={draftThread ? "" : activeTurnId}
                threadInProgress={
                  draftThread
                    ? false
                    : Boolean(
                        threadDetail?.thread.inProgress ||
                        selectedThread?.inProgress,
                      )
                }
                runtimeOptions={runtimeOptions}
                disabled={draftThread ? false : !selectedThreadId}
                sending={sending}
                onSend={draftThread ? sendDraftThreadMessage : sendMessage}
                onInterrupt={() => void interruptSelectedTurn()}
                onCompactThread={
                  draftThread ? undefined : () => void compactSelectedThread()
                }
              />
            }
          />
        )}
      </main>
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onOpenSearch={() => {
          setDrawerOpen(false);
          setSearchOpen(true);
        }}
        onOpenSettings={() => {
          setDrawerOpen(false);
          openSettings();
        }}
        auth={authGate.auth}
        accountStatus={accountStatus}
        threadList={threadList}
        archivedThreads={archivedThreads}
        threadListLoading={threadListLoading}
        hasMoreThreads={hasMoreThreads}
        hasMoreArchivedThreads={hasMoreArchivedThreads}
        loadingMoreThreads={loadingMoreThreads}
        loadingMoreArchivedThreads={loadingMoreArchivedThreads}
        selectedThreadId={visibleSelectedThreadId}
        selectedProjectId={selectedProjectId}
        selectedThreadProjectId={visibleSelectedThreadProjectId}
        onSelectThread={selectSyncedThread}
        onSelectProject={setSelectedProjectId}
        onCreateThread={openThreadDraft}
        onAddFavoriteProject={() => void addFavoriteProjectFromPrompt()}
        onLoadMoreThreads={() => void loadMoreThreads()}
        onLoadMoreArchivedThreads={() => void loadMoreArchivedThreads()}
        onRestoreThread={(threadId) => void restoreSyncedThread(threadId)}
        onTogglePinThread={(threadId, pinned) =>
          void setThreadPinned(threadId, pinned)
        }
        onArchiveThread={(threadId) => void archiveThreadById(threadId)}
        onStopThreadBackground={(threadId) =>
          void stopThreadBackgroundById(threadId)
        }
        onSignOut={signOut}
      />
      <SearchPanel
        open={searchOpen}
        threadList={threadList}
        onClose={() => setSearchOpen(false)}
        onSelectThread={selectSyncedThread}
      />
      <SettingsDiagnosticsPanel
        open={settingsOpen}
        onClose={closeSettings}
        onRefresh={refreshRuntimeStatus}
        onConfigChanged={applyConfig}
        auth={authGate.auth}
        config={config}
        health={health}
        ipc={ipc}
        appServer={appServer}
        accountStatus={accountStatus}
        protocolCompatibility={protocolCompatibility}
        selectedThreadId={selectedThreadId}
        realtimeEvents={realtimeEvents}
      />
    </div>
  );
}
