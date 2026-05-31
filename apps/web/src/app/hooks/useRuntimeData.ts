import { realtimeEventSchema, type RealtimeEvent } from "@codex-web/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addFavoriteProject,
  archiveThread,
  compactThread,
  createThread,
  decideApproval,
  getAccountStatus,
  getAppServerStatus,
  getApprovals,
  getConfig,
  getDomainThreads,
  getHealth,
  getOfficialIpcStatus,
  getProtocolCompatibility,
  getRuntimeOptions,
  getThreadDetail,
  interruptThreadTurn,
  pinThread,
  renameThread,
  startThreadTurn,
  steerThreadTurn,
  stopThreadBackground,
  setThreadGoal as setThreadGoalRequest,
  unarchiveThread,
  clearThreadGoal as clearThreadGoalRequest,
  type AccountStatus,
  type ApprovalDecision,
  type AppConfig,
  type AppServerStatus,
  type OfficialIpcStatus,
  type PendingApproval,
  type ProtocolCompatibility,
  type RuntimeOptions,
  type Thread,
  type ThreadDetail,
  type ThreadList,
} from "../../api";
import type { SendOptions } from "../components/Composer";
import { userFacingErrorMessage } from "../errorMessages";
import {
  acceptRealtimeThreadEvent,
  updateRealtimeServerInstance,
} from "../realtimeState";
import {
  ROUTE_CHANGE_EVENT,
  readAppRouteFromLocation,
  readThreadIdFromHash,
  readThreadIdFromLocation,
  readThreadIdFromPath,
  replaceRoute,
} from "../routes";
import {
  INITIAL_THREAD_DETAIL_REQUEST_STATE,
  beginThreadDetailRequest,
  shouldApplyThreadDetailResponse,
  type ThreadDetailRequestState,
} from "../threadDetailRequests";
import { appendThreadListPage, EMPTY_THREAD_LIST } from "../threadListPages";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function eventThreadId(event: RealtimeEvent): string {
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return "";
  const record = payload as Record<string, unknown>;
  return readString(record.threadId) || readString(record.conversationId);
}

function hasActiveDocumentSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

const UNPARSED_REALTIME_EVENT: RealtimeEvent = { type: "unparsed" };
const WEBSOCKET_ERROR_REALTIME_EVENT: RealtimeEvent = {
  type: "websocket.error",
};
const ACTIVE_THREAD_POLL_INTERVAL_MS = 5_000;
const REALTIME_REFRESH_DEBOUNCE_MS = 2_000;

function activeTurnIdFromDetail(detail: ThreadDetail | null): string {
  return (
    [...(detail?.turns ?? [])]
      .reverse()
      .find((turn) => turn.status === "active")?.id ?? ""
  );
}

type RefreshThreadDetailOptions = {
  silent?: boolean;
};

type RuntimeData = {
  health: string;
  config: AppConfig | null;
  ipc: OfficialIpcStatus | null;
  appServer: AppServerStatus | null;
  accountStatus: AccountStatus | null;
  protocolCompatibility: ProtocolCompatibility | null;
  runtimeOptions: RuntimeOptions | null;
  threadList: ThreadList;
  archivedThreads: Thread[];
  threadListLoading: boolean;
  hasMoreThreads: boolean;
  hasMoreArchivedThreads: boolean;
  loadingMoreThreads: boolean;
  loadingMoreArchivedThreads: boolean;
  selectedThreadId: string;
  selectedThread: Thread | null;
  threadDetail: ThreadDetail | null;
  activeTurnId: string;
  approvals: PendingApproval[];
  detailLoading: boolean;
  sending: boolean;
  error: string;
  realtimeEvents: RealtimeEvent[];
  selectThread: (threadId: string) => void;
  refreshRuntimeStatus: () => Promise<void>;
  applyConfig: (config: AppConfig) => void;
  createNewThread: (cwd?: string | null) => Promise<void>;
  loadMoreThreads: () => Promise<void>;
  loadMoreArchivedThreads: () => Promise<void>;
  renameSelectedThread: () => Promise<void>;
  archiveSelectedThread: () => Promise<void>;
  archiveThreadById: (threadId: string) => Promise<void>;
  setThreadPinned: (threadId: string, pinned: boolean) => Promise<void>;
  stopThreadBackgroundById: (threadId: string) => Promise<void>;
  restoreArchivedThread: (threadId: string) => Promise<void>;
  addFavoriteProjectFromPrompt: () => Promise<void>;
  interruptSelectedTurn: () => Promise<void>;
  compactSelectedThread: () => Promise<void>;
  setThreadGoalById: (
    threadId: string,
    input: { objective?: string; status?: "active" | "paused" },
  ) => Promise<void>;
  clearThreadGoalById: (threadId: string) => Promise<void>;
  decidePendingApproval: (
    id: string,
    decision: ApprovalDecision,
  ) => Promise<void>;
  sendDraftMessage: (
    cwd: string | null,
    text: string,
    attachmentIds?: string[],
    options?: SendOptions,
  ) => Promise<string | null>;
  sendMessage: (
    text: string,
    attachmentIds?: string[],
    options?: SendOptions,
  ) => Promise<void>;
  sendSideConversationMessage: (
    sideConversationId: string,
    text: string,
  ) => Promise<void>;
};

export function useRuntimeData(enabled: boolean): RuntimeData {
  const [health, setHealth] = useState("checking");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [ipc, setIpc] = useState<OfficialIpcStatus | null>(null);
  const [appServer, setAppServer] = useState<AppServerStatus | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(
    null,
  );
  const [protocolCompatibility, setProtocolCompatibility] =
    useState<ProtocolCompatibility | null>(null);
  const [runtimeOptions, setRuntimeOptions] = useState<RuntimeOptions | null>(
    null,
  );
  const [threadList, setThreadList] = useState<ThreadList>(EMPTY_THREAD_LIST);
  const [archivedThreadList, setArchivedThreadList] =
    useState<ThreadList>(EMPTY_THREAD_LIST);
  const [threadListLoading, setThreadListLoading] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState(() =>
    readThreadIdFromLocation(),
  );
  const [threadDetail, setThreadDetail] = useState<ThreadDetail | null>(null);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [loadingMoreArchivedThreads, setLoadingMoreArchivedThreads] =
    useState(false);
  const [error, setError] = useState("");
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const realtimeVersionsRef = useRef(new Map<string, number>());
  const realtimeServerInstanceRef = useRef("");
  const threadListHydratedRef = useRef(false);
  const selectedThreadIdRef = useRef(selectedThreadId);
  const threadDetailRef = useRef<ThreadDetail | null>(threadDetail);
  const detailRequestStateRef = useRef<ThreadDetailRequestState>(
    INITIAL_THREAD_DETAIL_REQUEST_STATE,
  );

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    threadDetailRef.current = threadDetail;
  }, [threadDetail]);

  const refreshStatus = useCallback(async () => {
    if (!enabled) return;
    const [
      healthResult,
      configResult,
      ipcResult,
      appServerResult,
      accountStatusResult,
      protocolCompatibilityResult,
    ] = await Promise.allSettled([
      getHealth(),
      getConfig(),
      getOfficialIpcStatus(),
      getAppServerStatus(),
      getAccountStatus(),
      getProtocolCompatibility(),
    ]);
    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value.ok ? "ready" : "unhealthy");
    } else {
      setHealth("error");
      throw healthResult.reason;
    }
    if (configResult.status === "fulfilled") setConfig(configResult.value);
    if (ipcResult.status === "fulfilled") setIpc(ipcResult.value);
    if (appServerResult.status === "fulfilled")
      setAppServer(appServerResult.value);
    if (accountStatusResult.status === "fulfilled")
      setAccountStatus(accountStatusResult.value);
    if (protocolCompatibilityResult.status === "fulfilled")
      setProtocolCompatibility(protocolCompatibilityResult.value);
  }, [enabled]);

  const refreshThreads = useCallback(async () => {
    if (!enabled) return;
    const showInitialLoading = !threadListHydratedRef.current;
    if (showInitialLoading) setThreadListLoading(true);
    try {
      const [nextList, nextArchivedList] = await Promise.all([
        getDomainThreads(60, false),
        getDomainThreads(20, true),
      ]);
      setThreadList(nextList);
      setArchivedThreadList(nextArchivedList);
      threadListHydratedRef.current = true;
      setSelectedThreadId((current) => {
        const nextThreadId = current || nextList.threads[0]?.id || "";
        if (!current && nextThreadId && readAppRouteFromLocation() === "chat")
          replaceRoute(nextThreadId);
        return nextThreadId;
      });
    } finally {
      if (showInitialLoading) setThreadListLoading(false);
    }
  }, [enabled]);

  const refreshApprovals = useCallback(async () => {
    if (!enabled) return;
    setApprovals(await getApprovals());
  }, [enabled]);

  const refreshThreadDetail = useCallback(
    async (threadId: string, options: RefreshThreadDetailOptions = {}) => {
      const request = beginThreadDetailRequest(
        detailRequestStateRef.current,
        threadId,
      );
      detailRequestStateRef.current = request.state;
      if (!enabled || !threadId) {
        setThreadDetail(null);
        setDetailLoading(false);
        return;
      }
      const currentDetail = threadDetailRef.current;
      const shouldShowLoading =
        !options.silent || currentDetail?.thread.id !== threadId;
      if (shouldShowLoading) setDetailLoading(true);
      try {
        const detail = await getThreadDetail(threadId);
        if (
          shouldApplyThreadDetailResponse(
            detailRequestStateRef.current,
            request.token,
          )
        ) {
          if (
            options.silent &&
            currentDetail?.thread.id === threadId &&
            hasActiveDocumentSelection()
          ) {
            return;
          }
          setThreadDetail(detail);
        }
      } catch (unknownError) {
        if (
          shouldApplyThreadDetailResponse(
            detailRequestStateRef.current,
            request.token,
          )
        )
          throw unknownError;
      } finally {
        if (
          shouldApplyThreadDetailResponse(
            detailRequestStateRef.current,
            request.token,
          )
        ) {
          setDetailLoading(false);
        }
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    async function refresh(): Promise<void> {
      try {
        await refreshStatus();
        await refreshApprovals();
        if (!disposed) setError("");
      } catch (unknownError) {
        if (!disposed) {
          setHealth("error");
          setError(
            userFacingErrorMessage(unknownError, "status refresh failed"),
          );
        }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [enabled, refreshApprovals, refreshStatus]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    getRuntimeOptions()
      .then((options) => {
        if (!disposed) setRuntimeOptions(options);
      })
      .catch((unknownError) => {
        if (!disposed)
          setError(
            userFacingErrorMessage(unknownError, "runtime options failed"),
          );
      });
    return () => {
      disposed = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    refreshThreads().catch((unknownError) => {
      if (!disposed)
        setError(userFacingErrorMessage(unknownError, "thread list failed"));
    });
    return () => {
      disposed = true;
    };
  }, [enabled, refreshThreads]);

  useEffect(() => {
    if (!enabled) return;
    const nextThreadId = readThreadIdFromLocation();
    if (readThreadIdFromHash() && !readThreadIdFromPath())
      replaceRoute(nextThreadId);
    if (nextThreadId) setSelectedThreadId(nextThreadId);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const handleRouteChange = () => {
      const nextThreadId = readThreadIdFromLocation();
      if (nextThreadId || readAppRouteFromLocation() === "chat") {
        setSelectedThreadId(nextThreadId);
      }
    };
    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener(ROUTE_CHANGE_EVENT, handleRouteChange);
    return () => {
      window.removeEventListener("popstate", handleRouteChange);
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener(ROUTE_CHANGE_EVENT, handleRouteChange);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    refreshThreadDetail(selectedThreadId).catch((unknownError) => {
      if (!disposed)
        setError(userFacingErrorMessage(unknownError, "thread detail failed"));
    });
    return () => {
      disposed = true;
    };
  }, [enabled, refreshThreadDetail, selectedThreadId]);

  const activePollingThreadId =
    selectedThreadId &&
    (threadDetail?.thread.inProgress ||
      threadList.threads.some(
        (thread) => thread.id === selectedThreadId && thread.inProgress,
      ))
      ? selectedThreadId
      : "";

  useEffect(() => {
    if (!enabled || !activePollingThreadId) return;
    let disposed = false;
    let inFlight = false;
    let pollCount = 0;
    const refreshActiveThread = async (): Promise<void> => {
      if (disposed || inFlight) return;
      const currentThreadId = selectedThreadIdRef.current;
      if (!currentThreadId || currentThreadId !== activePollingThreadId) return;
      inFlight = true;
      pollCount += 1;
      try {
        const tasks: Promise<unknown>[] = [
          refreshThreadDetail(currentThreadId, { silent: true }),
          refreshApprovals(),
        ];
        if (pollCount % 4 === 1) tasks.push(refreshThreads());
        await Promise.all(tasks);
      } catch {
        // Realtime events remain the primary path; this poll is only a quiet fallback.
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(
      () => void refreshActiveThread(),
      ACTIVE_THREAD_POLL_INTERVAL_MS,
    );
    void refreshActiveThread();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    activePollingThreadId,
    enabled,
    refreshApprovals,
    refreshThreadDetail,
    refreshThreads,
  ]);

  useEffect(() => {
    if (!enabled) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let realtimeRefreshTimer: number | null = null;
    let pendingRealtimeThreadsRefresh = false;
    let pendingRealtimeApprovalsRefresh = false;
    let pendingRealtimeDetailRefresh = false;
    let socket: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (disposed) return;
      const delayMs = Math.min(10_000, 500 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delayMs);
    };

    const scheduleRealtimeRefresh = ({
      includeThreads = false,
      includeApprovals = false,
      includeDetail = false,
    }: {
      includeThreads?: boolean;
      includeApprovals?: boolean;
      includeDetail?: boolean;
    }) => {
      if (disposed) return;
      if (includeThreads) pendingRealtimeThreadsRefresh = true;
      if (includeApprovals) pendingRealtimeApprovalsRefresh = true;
      if (includeDetail) pendingRealtimeDetailRefresh = true;
      if (realtimeRefreshTimer !== null) return;
      realtimeRefreshTimer = window.setTimeout(() => {
        realtimeRefreshTimer = null;
        if (disposed) return;
        const shouldRefreshThreads = pendingRealtimeThreadsRefresh;
        const shouldRefreshApprovals = pendingRealtimeApprovalsRefresh;
        const shouldRefreshDetail = pendingRealtimeDetailRefresh;
        pendingRealtimeThreadsRefresh = false;
        pendingRealtimeApprovalsRefresh = false;
        pendingRealtimeDetailRefresh = false;
        const currentThreadId = selectedThreadIdRef.current;
        const tasks: Promise<unknown>[] = [];
        if (shouldRefreshThreads)
          tasks.push(refreshThreads().catch(() => undefined));
        if (shouldRefreshApprovals)
          tasks.push(refreshApprovals().catch(() => undefined));
        if (shouldRefreshDetail && currentThreadId) {
          tasks.push(
            refreshThreadDetail(currentThreadId, { silent: true }).catch(
              () => undefined,
            ),
          );
        }
        void Promise.all(tasks);
      }, REALTIME_REFRESH_DEBOUNCE_MS);
    };

    const handleMessage = (messageEvent: MessageEvent) => {
      try {
        const parsed = realtimeEventSchema.safeParse(
          JSON.parse(messageEvent.data as string),
        );
        if (!parsed.success) throw parsed.error;
        const payload = parsed.data;
        setRealtimeEvents((current) => [payload, ...current].slice(0, 12));
        if (payload.type === "connected") {
          realtimeServerInstanceRef.current = updateRealtimeServerInstance(
            realtimeVersionsRef.current,
            realtimeServerInstanceRef.current,
            payload,
          );
          scheduleRealtimeRefresh({
            includeThreads: true,
            includeApprovals: true,
            includeDetail: true,
          });
        }
        if (
          payload.type === "official.threadStreamStateChanged" ||
          payload.type === "official.threadArchived" ||
          payload.type === "official.threadUnarchived" ||
          payload.type === "appServer.notification" ||
          payload.type === "approval.requested" ||
          payload.type === "approval.resolved"
        ) {
          const officialDecision =
            payload.type === "official.threadStreamStateChanged"
              ? acceptRealtimeThreadEvent(realtimeVersionsRef.current, payload)
              : null;
          if (officialDecision && !officialDecision.accepted) return;
          const changedThreadId =
            officialDecision?.threadId || eventThreadId(payload);
          const currentThreadId = selectedThreadIdRef.current;
          const streamPayload =
            payload.payload &&
            typeof payload.payload === "object" &&
            !Array.isArray(payload.payload)
              ? (payload.payload as Record<string, unknown>)
              : null;
          const inProgressSnapshot =
            payload.type === "official.threadStreamStateChanged" &&
            streamPayload?.changeType === "snapshot" &&
            streamPayload.isInProgress === true;
          scheduleRealtimeRefresh({
            includeThreads:
              payload.type !== "official.threadStreamStateChanged" ||
              !inProgressSnapshot,
            includeApprovals:
              payload.type === "approval.requested" ||
              payload.type === "approval.resolved",
            includeDetail:
              !changedThreadId || changedThreadId === currentThreadId,
          });
        }
      } catch {
        setRealtimeEvents((current) =>
          [UNPARSED_REALTIME_EVENT, ...current].slice(0, 12),
        );
      }
    };

    function connect(): void {
      if (disposed) return;
      const nextSocket = new WebSocket(
        `${protocol}//${window.location.host}/api/realtime`,
      );
      socket = nextSocket;
      nextSocket.addEventListener("open", () => {
        reconnectAttempt = 0;
      });
      nextSocket.addEventListener("message", handleMessage);
      nextSocket.addEventListener("error", () => {
        setRealtimeEvents((current) =>
          [WEBSOCKET_ERROR_REALTIME_EVENT, ...current].slice(0, 12),
        );
      });
      nextSocket.addEventListener("close", () => {
        if (socket === nextSocket) socket = null;
        scheduleReconnect();
      });
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (realtimeRefreshTimer !== null)
        window.clearTimeout(realtimeRefreshTimer);
      socket?.close();
    };
  }, [enabled, refreshApprovals, refreshThreadDetail, refreshThreads]);

  const selectThread = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
    replaceRoute(threadId);
  }, []);

  const createNewThread = useCallback(
    async (cwdOverride?: string | null) => {
      if (!enabled) return;
      try {
        const activeThread =
          threadList.threads.find((thread) => thread.id === selectedThreadId) ??
          null;
        const cwd =
          cwdOverride ??
          activeThread?.projectId ??
          threadList.projects[0]?.path ??
          null;
        const thread = await createThread({ cwd });
        await refreshThreads();
        selectThread(thread.id);
        await refreshThreadDetail(thread.id);
        setError("");
      } catch (unknownError) {
        setError(userFacingErrorMessage(unknownError, "create thread failed"));
      }
    },
    [
      enabled,
      refreshThreadDetail,
      refreshThreads,
      selectThread,
      selectedThreadId,
      threadList.projects,
      threadList.threads,
    ],
  );

  const sendDraftMessage = useCallback(
    async (
      cwd: string | null,
      text: string,
      attachmentIds: string[] = [],
      options: SendOptions = {},
    ) => {
      if (!enabled || (!text.trim() && attachmentIds.length === 0)) {
        return null;
      }
      setSending(true);
      try {
        const thread = await createThread({ cwd });
        await startThreadTurn({
          threadId: thread.id,
          text: text.trim(),
          model: options.model ?? "gpt-5.5",
          effort: options.effort ?? "xhigh",
          attachmentIds,
          skills: options.skills,
          collaborationMode: options.collaborationMode,
          permissionMode: options.permissionMode,
        });
        selectThread(thread.id);
        setThreadDetail({
          thread,
          goal: null,
          turns: [],
          subAgents: [],
          sideConversations: [],
        });
        setError("");
        window.setTimeout(() => {
          void refreshThreads().catch(() => undefined);
          void refreshThreadDetail(thread.id, { silent: true }).catch(
            () => undefined,
          );
        }, 600);
        return thread.id;
      } catch (unknownError) {
        setError(userFacingErrorMessage(unknownError, "send draft failed"));
        throw unknownError;
      } finally {
        setSending(false);
      }
    },
    [enabled, refreshThreadDetail, refreshThreads, selectThread],
  );

  const loadMoreThreads = useCallback(async () => {
    if (!enabled || !threadList.nextCursor || loadingMoreThreads) return;
    setLoadingMoreThreads(true);
    try {
      const nextList = await getDomainThreads(60, false, threadList.nextCursor);
      setThreadList((current) => appendThreadListPage(current, nextList));
      setError("");
    } catch (unknownError) {
      setError(
        userFacingErrorMessage(unknownError, "load more threads failed"),
      );
    } finally {
      setLoadingMoreThreads(false);
    }
  }, [enabled, loadingMoreThreads, threadList.nextCursor]);

  const loadMoreArchivedThreads = useCallback(async () => {
    if (
      !enabled ||
      !archivedThreadList.nextCursor ||
      loadingMoreArchivedThreads
    )
      return;
    setLoadingMoreArchivedThreads(true);
    try {
      const nextList = await getDomainThreads(
        20,
        true,
        archivedThreadList.nextCursor,
      );
      setArchivedThreadList((current) =>
        appendThreadListPage(current, nextList),
      );
      setError("");
    } catch (unknownError) {
      setError(
        userFacingErrorMessage(
          unknownError,
          "load more archived threads failed",
        ),
      );
    } finally {
      setLoadingMoreArchivedThreads(false);
    }
  }, [archivedThreadList.nextCursor, enabled, loadingMoreArchivedThreads]);

  const renameSelectedThread = useCallback(async () => {
    if (!enabled || !selectedThreadId) return;
    const current =
      threadList.threads.find((thread) => thread.id === selectedThreadId) ??
      threadDetail?.thread ??
      null;
    const nextTitle = window.prompt("重命名会话", current?.title ?? "");
    if (!nextTitle?.trim()) return;
    try {
      const renamed = await renameThread({
        threadId: selectedThreadId,
        title: nextTitle.trim(),
      });
      await refreshThreads();
      if (renamed)
        setThreadDetail((currentDetail) =>
          currentDetail ? { ...currentDetail, thread: renamed } : currentDetail,
        );
      setError("");
    } catch (unknownError) {
      setError(userFacingErrorMessage(unknownError, "rename thread failed"));
    }
  }, [
    enabled,
    refreshThreads,
    selectedThreadId,
    threadDetail?.thread,
    threadList.threads,
  ]);

  const archiveThreadById = useCallback(
    async (threadId: string) => {
      if (!enabled || !threadId) return;
      const current =
        threadList.threads.find((thread) => thread.id === threadId) ??
        (threadDetail?.thread.id === threadId ? threadDetail.thread : null) ??
        null;
      const confirmed = window.confirm(
        `归档“${current?.title ?? "当前会话"}”？`,
      );
      if (!confirmed) return;
      try {
        await archiveThread(threadId);
        const [nextList, nextArchivedList] = await Promise.all([
          getDomainThreads(60, false),
          getDomainThreads(20, true),
        ]);
        setThreadList(nextList);
        setArchivedThreadList(nextArchivedList);
        if (threadId === selectedThreadId) {
          const nextThreadId =
            nextList.threads.find((thread) => thread.id !== threadId)?.id ??
            nextList.threads[0]?.id ??
            "";
          setSelectedThreadId(nextThreadId);
          if (nextThreadId) {
            replaceRoute(nextThreadId);
            await refreshThreadDetail(nextThreadId);
          } else {
            setThreadDetail(null);
            replaceRoute("");
          }
        }
        setError("");
      } catch (unknownError) {
        setError(userFacingErrorMessage(unknownError, "archive thread failed"));
      }
    },
    [
      enabled,
      refreshThreadDetail,
      selectedThreadId,
      threadDetail?.thread,
      threadList.threads,
    ],
  );

  const archiveSelectedThread = useCallback(async () => {
    await archiveThreadById(selectedThreadId);
  }, [archiveThreadById, selectedThreadId]);

  const setThreadPinned = useCallback(
    async (threadId: string, pinned: boolean) => {
      if (!enabled || !threadId) return;
      try {
        await pinThread({ threadId, pinned });
        setThreadList((current) => ({
          ...current,
          threads: current.threads.map((thread) =>
            thread.id === threadId ? { ...thread, pinned } : thread,
          ),
        }));
        setThreadDetail((current) =>
          current?.thread.id === threadId
            ? { ...current, thread: { ...current.thread, pinned } }
            : current,
        );
        await refreshThreads();
        setError("");
      } catch (unknownError) {
        setError(userFacingErrorMessage(unknownError, "pin thread failed"));
      }
    },
    [enabled, refreshThreads],
  );

  const stopThreadBackgroundById = useCallback(
    async (threadId: string) => {
      if (!enabled || !threadId) return;
      try {
        await stopThreadBackground(threadId);
        await refreshThreads();
        if (threadId === selectedThreadId) await refreshThreadDetail(threadId);
        setError("");
      } catch (unknownError) {
        setError(
          userFacingErrorMessage(unknownError, "stop background failed"),
        );
      }
    },
    [enabled, refreshThreadDetail, refreshThreads, selectedThreadId],
  );

  const restoreArchivedThread = useCallback(
    async (threadId: string) => {
      if (!enabled || !threadId) return;
      try {
        const restored = await unarchiveThread(threadId);
        await refreshThreads();
        if (restored) {
          selectThread(restored.id);
          await refreshThreadDetail(restored.id);
        }
        setError("");
      } catch (unknownError) {
        setError(
          userFacingErrorMessage(unknownError, "unarchive thread failed"),
        );
      }
    },
    [enabled, refreshThreadDetail, refreshThreads, selectThread],
  );

  const addFavoriteProjectFromPrompt = useCallback(async () => {
    if (!enabled) return;
    const path = window.prompt("添加项目路径", "");
    if (!path?.trim()) return;
    try {
      await addFavoriteProject(path.trim());
      await refreshThreads();
      setError("");
    } catch (unknownError) {
      setError(userFacingErrorMessage(unknownError, "add project failed"));
    }
  }, [enabled, refreshThreads]);

  const interruptSelectedTurn = useCallback(async () => {
    if (!enabled || !selectedThreadId) return;
    const activeTurn = activeTurnIdFromDetail(threadDetail);
    if (!activeTurn) {
      setError("没有可中断的 active turn");
      return;
    }
    try {
      await interruptThreadTurn({
        threadId: selectedThreadId,
        turnId: activeTurn,
      });
      await refreshThreadDetail(selectedThreadId);
      await refreshThreads();
      setError("");
    } catch (unknownError) {
      setError(userFacingErrorMessage(unknownError, "interrupt failed"));
    }
  }, [
    enabled,
    refreshThreadDetail,
    refreshThreads,
    selectedThreadId,
    threadDetail,
  ]);

  const compactSelectedThread = useCallback(async () => {
    if (!enabled || !selectedThreadId) return;
    try {
      await compactThread(selectedThreadId);
      await refreshThreads();
      await refreshThreadDetail(selectedThreadId);
      setError("");
    } catch (unknownError) {
      setError(userFacingErrorMessage(unknownError, "compact thread failed"));
    }
  }, [enabled, refreshThreadDetail, refreshThreads, selectedThreadId]);

  const setThreadGoalById = useCallback(
    async (
      threadId: string,
      input: { objective?: string; status?: "active" | "paused" },
    ) => {
      if (!enabled || !threadId) return;
      try {
        const result = await setThreadGoalRequest({ threadId, ...input });
        setThreadDetail((current) =>
          current?.thread.id === threadId
            ? {
                ...current,
                goal: result.goal,
                thread: result.thread ?? current.thread,
              }
            : current,
        );
        await refreshThreads();
        await refreshThreadDetail(threadId, { silent: true });
        setError("");
      } catch (unknownError) {
        setError(userFacingErrorMessage(unknownError, "set goal failed"));
        throw unknownError;
      }
    },
    [enabled, refreshThreadDetail, refreshThreads],
  );

  const clearThreadGoalById = useCallback(
    async (threadId: string) => {
      if (!enabled || !threadId) return;
      try {
        const result = await clearThreadGoalRequest(threadId);
        setThreadDetail((current) =>
          current?.thread.id === threadId
            ? {
                ...current,
                goal: null,
                thread: result.thread ?? current.thread,
              }
            : current,
        );
        await refreshThreads();
        await refreshThreadDetail(threadId, { silent: true });
        setError("");
      } catch (unknownError) {
        setError(userFacingErrorMessage(unknownError, "clear goal failed"));
        throw unknownError;
      }
    },
    [enabled, refreshThreadDetail, refreshThreads],
  );

  const decidePendingApproval = useCallback(
    async (id: string, decision: ApprovalDecision) => {
      try {
        await decideApproval({ id, decision });
        await refreshApprovals();
        setError("");
      } catch (unknownError) {
        setError(
          userFacingErrorMessage(unknownError, "approval decision failed"),
        );
      }
    },
    [refreshApprovals],
  );

  const sendMessage = useCallback(
    async (
      text: string,
      attachmentIds: string[] = [],
      options: SendOptions = {},
    ) => {
      if (!selectedThreadId || (!text.trim() && attachmentIds.length === 0)) {
        return;
      }
      setSending(true);
      try {
        const activeTurnId = activeTurnIdFromDetail(threadDetail);
        if (options.mode === "steer" && activeTurnId) {
          await steerThreadTurn({
            threadId: selectedThreadId,
            expectedTurnId: activeTurnId,
            text: text.trim(),
            cwd: options.cwd,
            attachmentIds,
            skills: options.skills,
            permissionMode: options.permissionMode,
          });
        } else {
          await startThreadTurn({
            threadId: selectedThreadId,
            text: text.trim(),
            model: options.model ?? "gpt-5.5",
            effort: options.effort ?? "xhigh",
            attachmentIds,
            skills: options.skills,
            collaborationMode: options.collaborationMode,
            permissionMode: options.permissionMode,
          });
        }
        setError("");
        window.setTimeout(() => {
          void refreshThreads().catch(() => undefined);
          void refreshThreadDetail(selectedThreadId, { silent: true }).catch(
            () => undefined,
          );
        }, 600);
      } catch (unknownError) {
        setError(userFacingErrorMessage(unknownError, "send failed"));
        throw unknownError;
      } finally {
        setSending(false);
      }
    },
    [refreshThreadDetail, refreshThreads, selectedThreadId, threadDetail],
  );

  const sendSideConversationMessage = useCallback(
    async (sideConversationId: string, text: string) => {
      const trimmedText = text.trim();
      if (!enabled || !sideConversationId || !trimmedText) return;
      setSending(true);
      try {
        await startThreadTurn({
          threadId: sideConversationId,
          text: trimmedText,
          attachmentIds: [],
        });
        setError("");
        const parentThreadId = selectedThreadIdRef.current;
        window.setTimeout(() => {
          if (!parentThreadId) return;
          void refreshThreadDetail(parentThreadId, { silent: true }).catch(
            () => undefined,
          );
          void refreshThreads().catch(() => undefined);
        }, 600);
      } catch (unknownError) {
        setError(userFacingErrorMessage(unknownError, "send side chat failed"));
        throw unknownError;
      } finally {
        setSending(false);
      }
    },
    [enabled, refreshThreadDetail, refreshThreads],
  );

  const refreshRuntimeStatus = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshThreads(), refreshApprovals()]);
  }, [refreshApprovals, refreshStatus, refreshThreads]);

  const selectedThread = useMemo(
    () =>
      threadList.threads.find((thread) => thread.id === selectedThreadId) ??
      threadDetail?.thread ??
      null,
    [selectedThreadId, threadDetail?.thread, threadList.threads],
  );

  return {
    health,
    config,
    ipc,
    appServer,
    accountStatus,
    protocolCompatibility,
    runtimeOptions,
    threadList,
    archivedThreads: archivedThreadList.threads,
    threadListLoading,
    hasMoreThreads: Boolean(threadList.nextCursor),
    hasMoreArchivedThreads: Boolean(archivedThreadList.nextCursor),
    loadingMoreThreads,
    loadingMoreArchivedThreads,
    selectedThreadId,
    selectedThread,
    threadDetail,
    activeTurnId: activeTurnIdFromDetail(threadDetail),
    approvals,
    detailLoading,
    sending,
    error,
    realtimeEvents,
    selectThread,
    refreshRuntimeStatus,
    applyConfig: setConfig,
    createNewThread,
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
    setThreadGoalById,
    clearThreadGoalById,
    decidePendingApproval,
    sendDraftMessage,
    sendMessage,
    sendSideConversationMessage,
  };
}
