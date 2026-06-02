import { realtimeEventSchema, type RealtimeEvent } from "@codex-web/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addFavoriteProject,
  archiveThread,
  closeSideConversation,
  compactThread,
  createSideConversation,
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
const REALTIME_DETAIL_REFRESH_DEBOUNCE_MS = 100;
const THREAD_LIST_REFRESH_DEDUP_MS = 2_500;
const THREAD_DETAIL_REFRESH_DEDUP_MS = 2_500;
const ERROR_AUTO_DISMISS_MS = 7_000;

function hasSendContent(
  text: string,
  attachmentIds: string[] = [],
  options: SendOptions = {},
): boolean {
  return (
    text.trim().length > 0 ||
    attachmentIds.length > 0 ||
    Boolean(options.skills?.length)
  );
}

function activeTurnIdFromDetail(detail: ThreadDetail | null): string {
  return (
    [...(detail?.turns ?? [])]
      .reverse()
      .find((turn) => turn.status === "active")?.id ?? ""
  );
}

function detailInProgress(detail: ThreadDetail | null): boolean {
  return Boolean(detail?.thread.inProgress || activeTurnIdFromDetail(detail));
}

type RefreshThreadDetailOptions = {
  dedupe?: boolean;
  queueAfterInFlight?: boolean;
  silent?: boolean;
};

type RefreshThreadsOptions = {
  dedupe?: boolean;
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
  queuedMessages: QueuedThreadMessage[];
  removeQueuedMessage: (messageId: string) => void;
  steerQueuedMessage: (messageId: string) => Promise<void>;
  sendSideConversationMessage: (
    sideConversationId: string,
    text: string,
    attachmentIds?: string[],
    options?: SendOptions,
  ) => Promise<void>;
  createSideConversationForSelectedThread: (
    cwd?: string | null,
  ) => Promise<ThreadDetail["sideConversations"][number] | null>;
  closeSideConversationForSelectedThread: (
    sideConversationId: string,
  ) => Promise<void>;
};

export type QueuedThreadMessage = {
  id: string;
  threadId: string;
  text: string;
  attachmentCount: number;
  skillCount: number;
  createdAtMs: number;
};

type QueuedThreadMessageInternal = QueuedThreadMessage & {
  attachmentIds: string[];
  options: SendOptions;
};

function createQueuedMessageId(): string {
  const randomId =
    typeof window !== "undefined" && window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `queued:${randomId}`;
}

function toQueuedMessageView(
  message: QueuedThreadMessageInternal,
): QueuedThreadMessage {
  return {
    id: message.id,
    threadId: message.threadId,
    text: message.text,
    attachmentCount: message.attachmentCount,
    skillCount: message.skillCount,
    createdAtMs: message.createdAtMs,
  };
}

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
  const [queuedMessagesByThread, setQueuedMessagesByThread] = useState<
    Record<string, QueuedThreadMessageInternal[]>
  >({});
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const realtimeVersionsRef = useRef(new Map<string, number>());
  const realtimeServerInstanceRef = useRef("");
  const threadListHydratedRef = useRef(false);
  const threadListRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const threadListLastRefreshAtMsRef = useRef(0);
  const threadDetailRefreshInFlightRef = useRef(
    new Map<string, Promise<void>>(),
  );
  const threadDetailQueuedRefreshRef = useRef(new Set<string>());
  const threadDetailLastRefreshAtMsRef = useRef(new Map<string, number>());
  const selectedThreadIdRef = useRef(selectedThreadId);
  const threadDetailRef = useRef<ThreadDetail | null>(threadDetail);
  const queuedMessagesRef = useRef(queuedMessagesByThread);
  const queueFlushInFlightRef = useRef(new Set<string>());
  const detailRequestStateRef = useRef<ThreadDetailRequestState>(
    INITIAL_THREAD_DETAIL_REQUEST_STATE,
  );

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    threadDetailRef.current = threadDetail;
  }, [threadDetail]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), ERROR_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    queuedMessagesRef.current = queuedMessagesByThread;
  }, [queuedMessagesByThread]);

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

  const refreshThreads = useCallback(
    async (options: RefreshThreadsOptions = {}) => {
      if (!enabled) return;
      const nowMs = Date.now();
      if (
        options.dedupe &&
        threadListLastRefreshAtMsRef.current > 0 &&
        nowMs - threadListLastRefreshAtMsRef.current <
          THREAD_LIST_REFRESH_DEDUP_MS
      ) {
        return;
      }
      if (threadListRefreshInFlightRef.current) {
        return await threadListRefreshInFlightRef.current;
      }
      const showInitialLoading = !threadListHydratedRef.current;
      if (showInitialLoading) setThreadListLoading(true);
      const refreshPromise = (async () => {
        const [nextList, nextArchivedList] = await Promise.all([
          getDomainThreads(60, false),
          getDomainThreads(20, true),
        ]);
        setThreadList(nextList);
        setArchivedThreadList(nextArchivedList);
        threadListHydratedRef.current = true;
        threadListLastRefreshAtMsRef.current = Date.now();
        setSelectedThreadId((current) => {
          const nextThreadId = current || nextList.threads[0]?.id || "";
          if (!current && nextThreadId && readAppRouteFromLocation() === "chat")
            replaceRoute(nextThreadId);
          return nextThreadId;
        });
      })();
      threadListRefreshInFlightRef.current = refreshPromise;
      try {
        await refreshPromise;
      } finally {
        if (threadListRefreshInFlightRef.current === refreshPromise) {
          threadListRefreshInFlightRef.current = null;
        }
        if (showInitialLoading) setThreadListLoading(false);
      }
    },
    [enabled],
  );

  const refreshApprovals = useCallback(async () => {
    if (!enabled) return;
    setApprovals(await getApprovals());
  }, [enabled]);

  const refreshThreadDetail = useCallback(
    async (threadId: string, options: RefreshThreadDetailOptions = {}) => {
      if (!enabled || !threadId.trim()) {
        setThreadDetail(null);
        setDetailLoading(false);
        return;
      }
      const normalizedThreadId = threadId.trim();
      let forceRefresh = false;
      for (;;) {
        const nowMs = Date.now();
        const lastRefreshAtMs =
          threadDetailLastRefreshAtMsRef.current.get(normalizedThreadId) ?? 0;
        if (
          !forceRefresh &&
          options.dedupe &&
          lastRefreshAtMs > 0 &&
          nowMs - lastRefreshAtMs < THREAD_DETAIL_REFRESH_DEDUP_MS
        ) {
          return;
        }
        const inFlight =
          threadDetailRefreshInFlightRef.current.get(normalizedThreadId);
        if (
          inFlight &&
          detailRequestStateRef.current.activeThreadId === normalizedThreadId
        ) {
          if (options.queueAfterInFlight) {
            threadDetailQueuedRefreshRef.current.add(normalizedThreadId);
          }
          let inFlightError: unknown = null;
          let shouldRefreshAfterInFlight = false;
          try {
            await inFlight;
          } catch (unknownError) {
            inFlightError = unknownError;
          } finally {
            shouldRefreshAfterInFlight = Boolean(
              options.queueAfterInFlight &&
                threadDetailQueuedRefreshRef.current.delete(normalizedThreadId),
            );
          }
          if (inFlightError) throw inFlightError;
          if (shouldRefreshAfterInFlight) {
            if (selectedThreadIdRef.current !== normalizedThreadId) return;
            forceRefresh = true;
            continue;
          }
          return;
        }
        const request = beginThreadDetailRequest(
          detailRequestStateRef.current,
          normalizedThreadId,
        );
        detailRequestStateRef.current = request.state;
        const currentDetail = threadDetailRef.current;
        const shouldShowLoading =
          !options.silent || currentDetail?.thread.id !== normalizedThreadId;
        if (shouldShowLoading) setDetailLoading(true);
        const refreshPromise = (async () => {
          const detail = await getThreadDetail(normalizedThreadId);
          if (
            shouldApplyThreadDetailResponse(
              detailRequestStateRef.current,
              request.token,
            )
          ) {
            if (
              options.silent &&
              currentDetail?.thread.id === normalizedThreadId &&
              hasActiveDocumentSelection()
            ) {
              return;
            }
            setThreadDetail(detail);
            threadDetailLastRefreshAtMsRef.current.set(
              normalizedThreadId,
              Date.now(),
            );
          }
        })();
        threadDetailRefreshInFlightRef.current.set(
          normalizedThreadId,
          refreshPromise,
        );
        try {
          await refreshPromise;
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
            threadDetailRefreshInFlightRef.current.get(normalizedThreadId) ===
            refreshPromise
          ) {
            threadDetailRefreshInFlightRef.current.delete(normalizedThreadId);
          }
          if (
            shouldApplyThreadDetailResponse(
              detailRequestStateRef.current,
              request.token,
            )
          ) {
            setDetailLoading(false);
          }
        }
        return;
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
          refreshThreadDetail(currentThreadId, { dedupe: true, silent: true }),
          refreshApprovals(),
        ];
        if (pollCount % 4 === 1) tasks.push(refreshThreads({ dedupe: true }));
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
    let realtimeDetailRefreshTimer: number | null = null;
    let pendingRealtimeThreadsRefresh = false;
    let pendingRealtimeApprovalsRefresh = false;
    let pendingRealtimeDedupeRefresh = true;
    let pendingRealtimeDetailDedupeRefresh = true;
    let socket: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (disposed) return;
      const delayMs = Math.min(10_000, 500 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delayMs);
    };

    const scheduleRealtimeDetailRefresh = ({
      dedupe = false,
      delayMs = REALTIME_DETAIL_REFRESH_DEBOUNCE_MS,
    }: {
      dedupe?: boolean;
      delayMs?: number;
    } = {}) => {
      if (disposed) return;
      if (!dedupe) pendingRealtimeDetailDedupeRefresh = false;
      if (realtimeDetailRefreshTimer !== null) return;
      realtimeDetailRefreshTimer = window.setTimeout(() => {
        realtimeDetailRefreshTimer = null;
        if (disposed) return;
        const shouldDedupeRefresh = pendingRealtimeDetailDedupeRefresh;
        pendingRealtimeDetailDedupeRefresh = true;
        const currentThreadId = selectedThreadIdRef.current;
        if (!currentThreadId) return;
        void refreshThreadDetail(currentThreadId, {
          dedupe: shouldDedupeRefresh,
          queueAfterInFlight: true,
          silent: true,
        }).catch(() => undefined);
      }, delayMs);
    };

    const scheduleRealtimeRefresh = ({
      includeThreads = false,
      includeApprovals = false,
      includeDetail = false,
      dedupe = false,
    }: {
      includeThreads?: boolean;
      includeApprovals?: boolean;
      includeDetail?: boolean;
      dedupe?: boolean;
    }) => {
      if (disposed) return;
      if (includeDetail) scheduleRealtimeDetailRefresh({ dedupe });
      if (!includeThreads && !includeApprovals) return;
      if (includeThreads) pendingRealtimeThreadsRefresh = true;
      if (includeApprovals) pendingRealtimeApprovalsRefresh = true;
      if (!dedupe) pendingRealtimeDedupeRefresh = false;
      if (realtimeRefreshTimer !== null) return;
      realtimeRefreshTimer = window.setTimeout(() => {
        realtimeRefreshTimer = null;
        if (disposed) return;
        const shouldRefreshThreads = pendingRealtimeThreadsRefresh;
        const shouldRefreshApprovals = pendingRealtimeApprovalsRefresh;
        const shouldDedupeRefresh = pendingRealtimeDedupeRefresh;
        pendingRealtimeThreadsRefresh = false;
        pendingRealtimeApprovalsRefresh = false;
        pendingRealtimeDedupeRefresh = true;
        const tasks: Promise<unknown>[] = [];
        if (shouldRefreshThreads)
          tasks.push(
            refreshThreads({ dedupe: shouldDedupeRefresh }).catch(
              () => undefined,
            ),
          );
        if (shouldRefreshApprovals)
          tasks.push(refreshApprovals().catch(() => undefined));
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
          const previousServerInstance = realtimeServerInstanceRef.current;
          realtimeServerInstanceRef.current = updateRealtimeServerInstance(
            realtimeVersionsRef.current,
            previousServerInstance,
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
      if (realtimeDetailRefreshTimer !== null)
        window.clearTimeout(realtimeDetailRefreshTimer);
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
      if (!enabled || !hasSendContent(text, attachmentIds, options)) {
        return null;
      }
      setSending(true);
      try {
        const thread = await createThread({ cwd });
        await startThreadTurn({
          threadId: thread.id,
          text: text.trim(),
          cwd,
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
      const current = archivedThreadList.threads.find(
        (thread) => thread.id === threadId,
      );
      const confirmed = window.confirm(
        `恢复归档会话“${current?.title ?? "当前会话"}”？`,
      );
      if (!confirmed) return;
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
    [
      archivedThreadList.threads,
      enabled,
      refreshThreadDetail,
      refreshThreads,
      selectThread,
    ],
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
      const selectedThreadInProgress = threadList.threads.some(
        (thread) => thread.id === selectedThreadId && thread.inProgress,
      );
      if (detailInProgress(threadDetail) || selectedThreadInProgress) {
        await stopThreadBackgroundById(selectedThreadId);
        return;
      }
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
    stopThreadBackgroundById,
    threadDetail,
    threadList.threads,
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

  const scheduleThreadRefresh = useCallback(
    (threadId: string, delayMs = 600) => {
      window.setTimeout(() => {
        void refreshThreads().catch(() => undefined);
        void refreshThreadDetail(threadId, { silent: true }).catch(
          () => undefined,
        );
      }, delayMs);
    },
    [refreshThreadDetail, refreshThreads],
  );

  const removeQueuedMessage = useCallback((messageId: string) => {
    if (!messageId) return;
    setQueuedMessagesByThread((current) => {
      let changed = false;
      const next: Record<string, QueuedThreadMessageInternal[]> = {};
      for (const [threadId, messages] of Object.entries(current)) {
        const filtered = messages.filter((message) => message.id !== messageId);
        if (filtered.length !== messages.length) changed = true;
        if (filtered.length > 0) next[threadId] = filtered;
      }
      return changed ? next : current;
    });
  }, []);

  const enqueueQueuedMessage = useCallback(
    (
      threadId: string,
      text: string,
      attachmentIds: string[],
      options: SendOptions,
    ) => {
      const queuedMessage: QueuedThreadMessageInternal = {
        id: createQueuedMessageId(),
        threadId,
        text,
        attachmentCount: attachmentIds.length,
        skillCount: options.skills?.length ?? 0,
        attachmentIds: [...attachmentIds],
        createdAtMs: Date.now(),
        options: { ...options, mode: "start" },
      };
      setQueuedMessagesByThread((current) => ({
        ...current,
        [threadId]: [...(current[threadId] ?? []), queuedMessage],
      }));
    },
    [],
  );

  const startQueuedMessage = useCallback(
    async (threadId: string, message: QueuedThreadMessageInternal) => {
      await startThreadTurn({
        threadId,
        text: message.text,
        cwd: message.options.cwd,
        model: message.options.model ?? "gpt-5.5",
        effort: message.options.effort ?? "xhigh",
        attachmentIds: message.attachmentIds,
        skills: message.options.skills,
        collaborationMode: message.options.collaborationMode,
        permissionMode: message.options.permissionMode,
      });
    },
    [],
  );

  const steerQueuedMessage = useCallback(
    async (messageId: string) => {
      const threadId = selectedThreadIdRef.current;
      if (!enabled || !threadId || !messageId) return;
      const message = queuedMessagesRef.current[threadId]?.find(
        (candidate) => candidate.id === messageId,
      );
      if (!message) return;
      const activeTurnId = activeTurnIdFromDetail(threadDetailRef.current);
      if (!activeTurnId) {
        setSending(true);
        try {
          await startQueuedMessage(threadId, message);
          removeQueuedMessage(messageId);
          setError("");
          scheduleThreadRefresh(threadId);
        } catch (unknownError) {
          setError(userFacingErrorMessage(unknownError, "send failed"));
          throw unknownError;
        } finally {
          setSending(false);
        }
        return;
      }
      setSending(true);
      try {
        await steerThreadTurn({
          threadId,
          expectedTurnId: activeTurnId,
          text: message.text,
          cwd: message.options.cwd,
          attachmentIds: message.attachmentIds,
          skills: message.options.skills,
          permissionMode: message.options.permissionMode,
        });
        removeQueuedMessage(messageId);
        setError("");
        scheduleThreadRefresh(threadId);
      } catch (unknownError) {
        setError(userFacingErrorMessage(unknownError, "steer failed"));
        throw unknownError;
      } finally {
        setSending(false);
      }
    },
    [enabled, removeQueuedMessage, scheduleThreadRefresh, startQueuedMessage],
  );

  const sendMessage = useCallback(
    async (
      text: string,
      attachmentIds: string[] = [],
      options: SendOptions = {},
    ) => {
      if (!selectedThreadId || !hasSendContent(text, attachmentIds, options)) {
        return;
      }
      const trimmedText = text.trim();
      const activeTurnId = activeTurnIdFromDetail(threadDetail);
      const runningThread = detailInProgress(threadDetail);
      if (runningThread && options.mode !== "steer") {
        enqueueQueuedMessage(
          selectedThreadId,
          trimmedText,
          attachmentIds,
          options,
        );
        setError("");
        scheduleThreadRefresh(selectedThreadId, 1000);
        return;
      }
      setSending(true);
      try {
        if (options.mode === "steer" && activeTurnId) {
          await steerThreadTurn({
            threadId: selectedThreadId,
            expectedTurnId: activeTurnId,
            text: trimmedText,
            cwd: options.cwd,
            attachmentIds,
            skills: options.skills,
            permissionMode: options.permissionMode,
          });
        } else {
          await startThreadTurn({
            threadId: selectedThreadId,
            text: trimmedText,
            cwd: options.cwd,
            model: options.model ?? "gpt-5.5",
            effort: options.effort ?? "xhigh",
            attachmentIds,
            skills: options.skills,
            collaborationMode: options.collaborationMode,
            permissionMode: options.permissionMode,
          });
        }
        setError("");
        scheduleThreadRefresh(selectedThreadId);
      } catch (unknownError) {
        setError(userFacingErrorMessage(unknownError, "send failed"));
        throw unknownError;
      } finally {
        setSending(false);
      }
    },
    [
      enqueueQueuedMessage,
      scheduleThreadRefresh,
      selectedThreadId,
      threadDetail,
    ],
  );

  useEffect(() => {
    if (!enabled || !selectedThreadId || !threadDetail) return;
    if (detailInProgress(threadDetail)) return;
    const nextMessage = queuedMessagesByThread[selectedThreadId]?.[0];
    if (!nextMessage) return;
    if (queueFlushInFlightRef.current.has(selectedThreadId)) return;

    let disposed = false;
    const threadId = selectedThreadId;
    queueFlushInFlightRef.current.add(threadId);
    setSending(true);
    void (async () => {
      try {
        await startQueuedMessage(threadId, nextMessage);
        removeQueuedMessage(nextMessage.id);
        setError("");
        scheduleThreadRefresh(threadId);
      } catch (unknownError) {
        removeQueuedMessage(nextMessage.id);
        if (!disposed)
          setError(userFacingErrorMessage(unknownError, "send failed"));
      } finally {
        if (!disposed) setSending(false);
        window.setTimeout(() => {
          queueFlushInFlightRef.current.delete(threadId);
          void refreshThreadDetail(threadId, { silent: true }).catch(
            () => undefined,
          );
        }, 800);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [
    enabled,
    queuedMessagesByThread,
    refreshThreadDetail,
    removeQueuedMessage,
    scheduleThreadRefresh,
    selectedThreadId,
    startQueuedMessage,
    threadDetail,
  ]);

  const sendSideConversationMessage = useCallback(
    async (
      sideConversationId: string,
      text: string,
      attachmentIds: string[] = [],
      options: SendOptions = {},
    ) => {
      const trimmedText = text.trim();
      if (
        !enabled ||
        !sideConversationId ||
        !hasSendContent(trimmedText, attachmentIds, options)
      )
        return;
      setSending(true);
      try {
        await startThreadTurn({
          threadId: sideConversationId,
          text: trimmedText,
          cwd: options.cwd,
          model: options.model ?? "gpt-5.5",
          effort: options.effort ?? "xhigh",
          attachmentIds,
          skills: options.skills,
          collaborationMode: options.collaborationMode,
          permissionMode: options.permissionMode,
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

  const selectedThread = useMemo(
    () =>
      threadList.threads.find((thread) => thread.id === selectedThreadId) ??
      threadDetail?.thread ??
      null,
    [selectedThreadId, threadDetail?.thread, threadList.threads],
  );
  const queuedMessages = useMemo(
    () =>
      selectedThreadId
        ? (queuedMessagesByThread[selectedThreadId] ?? []).map(
            toQueuedMessageView,
          )
        : [],
    [queuedMessagesByThread, selectedThreadId],
  );

  const createSideConversationForSelectedThread = useCallback(
    async (cwd?: string | null) => {
      const parentThreadId = selectedThreadIdRef.current;
      if (!enabled || !parentThreadId) return null;
      try {
        const sideConversation = await createSideConversation({
          threadId: parentThreadId,
          cwd: cwd ?? selectedThread?.path ?? selectedThread?.projectId ?? null,
        });
        setThreadDetail((current) =>
          current?.thread.id === parentThreadId &&
          !current.sideConversations.some(
            (conversation) => conversation.id === sideConversation.id,
          )
            ? {
                ...current,
                sideConversations: [
                  ...current.sideConversations,
                  sideConversation,
                ],
              }
            : current,
        );
        setError("");
        window.setTimeout(() => {
          void refreshThreadDetail(parentThreadId, { silent: true }).catch(
            () => undefined,
          );
          void refreshThreads().catch(() => undefined);
        }, 600);
        return sideConversation;
      } catch (unknownError) {
        setError(
          userFacingErrorMessage(
            unknownError,
            "create side conversation failed",
          ),
        );
        throw unknownError;
      }
    },
    [enabled, refreshThreadDetail, refreshThreads, selectedThread],
  );

  const closeSideConversationForSelectedThread = useCallback(
    async (sideConversationId: string) => {
      const parentThreadId = selectedThreadIdRef.current;
      if (!enabled || !parentThreadId || !sideConversationId) return;
      setThreadDetail((current) =>
        current?.thread.id === parentThreadId
          ? {
              ...current,
              sideConversations: current.sideConversations.filter(
                (conversation) => conversation.id !== sideConversationId,
              ),
            }
          : current,
      );
      try {
        await closeSideConversation({
          threadId: parentThreadId,
          sideConversationId,
        });
        setError("");
      } catch (unknownError) {
        setError(
          userFacingErrorMessage(
            unknownError,
            "close side conversation failed",
          ),
        );
        throw unknownError;
      } finally {
        window.setTimeout(() => {
          void refreshThreadDetail(parentThreadId, { silent: true }).catch(
            () => undefined,
          );
          void refreshThreads().catch(() => undefined);
        }, 300);
      }
    },
    [enabled, refreshThreadDetail, refreshThreads],
  );

  const refreshRuntimeStatus = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshThreads(), refreshApprovals()]);
  }, [refreshApprovals, refreshStatus, refreshThreads]);

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
    queuedMessages,
    removeQueuedMessage,
    steerQueuedMessage,
    sendSideConversationMessage,
    createSideConversationForSelectedThread,
    closeSideConversationForSelectedThread,
  };
}
