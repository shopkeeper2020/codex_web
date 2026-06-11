import {
  ArrowLeft,
  Copy,
  Database,
  FileJson,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import {
  getCacheStatus,
  getDiagnostics,
  getDiagnosticsExport,
  getProtocolCompatibility,
  type CacheStatus,
  type DiagnosticEvent,
  type DiagnosticsExport,
  type ProtocolCompatibility,
} from "../../api";
import styles from "../App.module.css";
import { StatusBadge, type StatusTone } from "./StatusBadge";

type DebugSnapshot = {
  compatibility: ProtocolCompatibility | null;
  cache: CacheStatus | null;
  diagnostics: DiagnosticEvent[];
  exportPayload: DiagnosticsExport | null;
};

const EMPTY_SNAPSHOT: DebugSnapshot = {
  compatibility: null,
  cache: null,
  diagnostics: [],
  exportPayload: null,
};

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  return JSON.stringify(value, null, 2);
}

function DebugCard({
  icon,
  title,
  value,
  detail,
}: {
  icon: ReactElement;
  title: string;
  value: string;
  detail: string;
}): ReactElement {
  return (
    <section className={styles.debugCard}>
      <span className={styles.debugCardIcon}>{icon}</span>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </section>
  );
}

function JsonPanel({
  title,
  value,
}: {
  title: string;
  value: unknown;
}): ReactElement {
  return (
    <section className={styles.debugPanel}>
      <h3>{title}</h3>
      <pre>{formatJson(value)}</pre>
    </section>
  );
}

function compatibilityTone(state: string | undefined): StatusTone {
  return state === "compatible" ? "ready" : state ? "warn" : "idle";
}

function readRegisteredHandlerMethods(
  officialIpc: ProtocolCompatibility["officialIpc"] | undefined,
): string[] {
  const status = officialIpc as Record<string, unknown> | undefined;
  const handlers = status?.registeredRequestHandlers;
  if (!Array.isArray(handlers)) return [];
  return handlers
    .map((handler) => {
      if (
        handler === null ||
        typeof handler !== "object" ||
        Array.isArray(handler)
      ) {
        return "";
      }
      const method = (handler as Record<string, unknown>).method;
      return typeof method === "string" ? method : "";
    })
    .filter(Boolean)
    .sort();
}

export function DebugPage({ onBack }: { onBack: () => void }): ReactElement {
  const [snapshot, setSnapshot] = useState<DebugSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const [compatibility, cache, diagnostics, exportPayload] =
        await Promise.all([
          getProtocolCompatibility(),
          getCacheStatus(),
          getDiagnostics(),
          getDiagnosticsExport(),
        ]);
      setSnapshot({ compatibility, cache, diagnostics, exportPayload });
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "debug refresh failed",
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyExport(): Promise<void> {
    setCopying(true);
    setError("");
    setMessage("");
    try {
      const payload = snapshot.exportPayload ?? (await getDiagnosticsExport());
      await navigator.clipboard.writeText(formatJson(payload));
      setMessage("已复制脱敏诊断 JSON。");
    } catch (unknownError) {
      setError(
        unknownError instanceof Error ? unknownError.message : "copy failed",
      );
    } finally {
      setCopying(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const compatibility = snapshot.compatibility;
  const cache = snapshot.cache;
  const officialIpc = compatibility?.officialIpc;
  const appServer = compatibility?.appServer;
  const methodCount =
    compatibility?.summary.methodCount ??
    Object.keys(compatibility?.adapter.ipcMethodVersions ?? {}).length;
  const compatibilityState = compatibility?.summary.state ?? "checking";
  const compatibilityDetail =
    compatibility?.summary.reason ?? `${methodCount} IPC methods`;
  const registeredHandlerMethods = readRegisteredHandlerMethods(officialIpc);

  return (
    <section className={styles.debugPage} aria-label="Debug diagnostics">
      <header className={styles.debugHeader}>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="返回会话"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1>Debug</h1>
          <p>IPC、app-server、缓存和脱敏诊断快照</p>
        </div>
        <div className={styles.debugActions}>
          <button
            className={styles.controlButton}
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={15} />
            {loading ? "Refreshing" : "Refresh"}
          </button>
          <button
            className={styles.controlButton}
            type="button"
            disabled={copying}
            onClick={() => void copyExport()}
          >
            <Copy size={15} />
            {copying ? "Copying" : "Copy export"}
          </button>
        </div>
      </header>

      <div className={styles.debugBody}>
        <div className={styles.debugSummary}>
          <DebugCard
            icon={<ShieldCheck size={17} />}
            title="Compatibility"
            value={compatibilityState}
            detail={compatibilityDetail}
          />
          <DebugCard
            icon={<Network size={17} />}
            title="Official IPC"
            value={officialIpc?.connected ? "connected" : "offline"}
            detail={
              officialIpc?.clientId ?? officialIpc?.lastError ?? "waiting"
            }
          />
          <DebugCard
            icon={<Server size={17} />}
            title="App server"
            value={
              appServer?.initialized
                ? "initialized"
                : appServer?.running
                  ? "running"
                  : "idle"
            }
            detail={
              appServer?.pid
                ? `pid ${appServer.pid}${appServer.lastWarning ? " · warning" : ""}`
                : (appServer?.lastError ??
                  appServer?.lastWarning ??
                  "not started")
            }
          />
          <DebugCard
            icon={<Database size={17} />}
            title="SQLite cache"
            value={cache ? `${cache.attachmentCount} attachments` : "loading"}
            detail={cache?.path ?? "cache status pending"}
          />
          <DebugCard
            icon={<FileJson size={17} />}
            title="IPC methods"
            value={`${methodCount} declared`}
            detail={
              registeredHandlerMethods.length
                ? `${registeredHandlerMethods.length} handlers registered`
                : (compatibility?.adapter.version ?? "adapter pending")
            }
          />
        </div>

        <div className={styles.debugStatusLine}>
          <StatusBadge
            label={`compatibility ${compatibilityState}`}
            tone={compatibilityTone(compatibility?.summary.state)}
          />
          <StatusBadge
            label={
              officialIpc?.rawFrameLogging
                ? "raw frame summaries on"
                : "raw frame summaries off"
            }
            tone="idle"
          />
          <StatusBadge
            label={`${snapshot.diagnostics.length} diagnostic events`}
            tone="idle"
          />
          {snapshot.exportPayload ? (
            <StatusBadge
              label={`export schema ${snapshot.exportPayload.schemaVersion}`}
              tone="ready"
            />
          ) : null}
        </div>
        {message ? (
          <div className={styles.settingsNotice}>{message}</div>
        ) : null}
        {error ? <div className={styles.settingsError}>{error}</div> : null}

        <div className={styles.debugGrid}>
          <JsonPanel title="Protocol compatibility" value={compatibility} />
          <JsonPanel
            title="Follower method capabilities"
            value={compatibility?.adapter.followerMethodCapabilities ?? []}
          />
          <JsonPanel
            title="Diagnostics export"
            value={snapshot.exportPayload}
          />
          <JsonPanel title="Recent diagnostics" value={snapshot.diagnostics} />
          <JsonPanel title="Cache status" value={cache} />
        </div>
      </div>
    </section>
  );
}
