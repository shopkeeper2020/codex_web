import {
  Activity,
  CheckCircle2,
  Copy,
  Download,
  Folder,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { RealtimeEvent } from "@codex-web/api";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import {
  addFavoriteProject,
  cleanupUnassociatedAttachments,
  getDiagnosticsExport,
  getAttachmentStorageStatus,
  getAuthSessions,
  getFavoriteProjects,
  getLanAccess,
  getSyncReadiness,
  removeFavoriteProject,
  revokeAllAuthSessions,
  revokeAuthSession,
  revokeOtherAuthSessions,
  updateLanPassword,
  updateSettings,
  type AccountStatus,
  type AttachmentStorageStatus,
  type AppConfig,
  type AppServerStatus,
  type AuthSession,
  type AuthStatus,
  type DiagnosticsExport,
  type LanAccess,
  type OfficialIpcStatus,
  type Project,
  type ProtocolCompatibility,
  type SyncReadiness,
} from "../../api";
import styles from "../App.module.css";

type RuntimeSnapshotProps = {
  auth: AuthStatus | null;
  config: AppConfig | null;
  health: string;
  ipc: OfficialIpcStatus | null;
  appServer: AppServerStatus | null;
  accountStatus: AccountStatus | null;
  protocolCompatibility: ProtocolCompatibility | null;
  selectedThreadId: string;
  realtimeEvents: RealtimeEvent[];
};

type SettingsDiagnosticsPanelProps = RuntimeSnapshotProps & {
  open: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onConfigChanged: (config: AppConfig) => void;
};

type SettingsTab =
  | "general"
  | "projects"
  | "security"
  | "network"
  | "appearance"
  | "account"
  | "diagnostics";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "projects", label: "Projects" },
  { id: "security", label: "Security" },
  { id: "network", label: "Network" },
  { id: "appearance", label: "Appearance" },
  { id: "account", label: "Account" },
  { id: "diagnostics", label: "Diagnostics" },
];

function statusLabel(
  value: boolean | undefined,
  ready = "ready",
  waiting = "waiting",
): string {
  if (value === true) return ready;
  if (value === false) return "offline";
  return waiting;
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  return JSON.stringify(value, null, 2);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function diagnosticsFilename(value: string): string {
  const safeTimestamp = value.replace(/[:.]/g, "-");
  return `codex-web-diagnostics-${safeTimestamp}.json`;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function syncDoctorCommand(
  kind: "send" | "steer" | "interrupt",
  threadId: string,
): string {
  const thread = quotePowerShell(threadId);
  const report = `data\\tmp\\sync-report-${kind}-$(Get-Date -Format yyyyMMdd-HHmmss).json`;
  if (kind === "send") {
    return `pnpm sync:doctor -- --thread ${thread} --send --text "codex_web sync $(Get-Date -Format o)" --report "${report}"`;
  }
  if (kind === "steer") {
    return `pnpm sync:doctor -- --thread ${thread} --steer --text "codex_web steer $(Get-Date -Format o)" --report "${report}"`;
  }
  return `pnpm sync:doctor -- --thread ${thread} --interrupt --report "${report}"`;
}

function protocolCompatibilitySummary(
  protocolCompatibility: ProtocolCompatibility | null,
): { value: string; detail: string } {
  if (!protocolCompatibility)
    return { value: "checking", detail: "adapter pending" };
  const adapter = `${protocolCompatibility.adapter.name} v${protocolCompatibility.adapter.version}`;
  const methodSummary = `${protocolCompatibility.summary.methodCount} IPC methods`;
  const reason = protocolCompatibility.summary.reason;
  return {
    value: protocolCompatibility.summary.state,
    detail: reason
      ? `${adapter} · ${methodSummary} · ${reason}`
      : `${adapter} · ${methodSummary}`,
  };
}

function followerHandlerSummary(
  protocolCompatibility: ProtocolCompatibility | null,
): { value: string; detail: string } {
  if (!protocolCompatibility) {
    return { value: "checking", detail: "handler coverage pending" };
  }
  const registered =
    protocolCompatibility.summary.registeredHandlerCount ??
    protocolCompatibility.adapter.registeredRequestHandlers.length;
  const missing = protocolCompatibility.adapter.unregisteredFollowerMethods;
  return {
    value: `${registered} registered`,
    detail: missing.length
      ? `${missing.length} follower methods not implemented yet`
      : "all declared follower handlers registered",
  };
}

function DiagnosticsRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}): ReactElement {
  return (
    <div className={styles.diagnosticsRow}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function JsonBlock({
  label,
  value,
}: {
  label: string;
  value: unknown;
}): ReactElement {
  return (
    <section className={styles.diagnosticsSection}>
      <h3>{label}</h3>
      <pre className={styles.jsonBlock}>{formatJson(value)}</pre>
    </section>
  );
}

function TroubleshootingPackage({
  exportPayload,
  copying,
  downloading,
  onCopy,
  onDownload,
}: {
  exportPayload: DiagnosticsExport | null;
  copying: boolean;
  downloading: boolean;
  onCopy: () => Promise<void>;
  onDownload: () => Promise<void>;
}): ReactElement {
  return (
    <section className={styles.diagnosticsSection}>
      <h3>Troubleshooting package</h3>
      <div className={styles.diagnosticsPackage}>
        <div className={styles.diagnosticsPackageHeader}>
          <span className={styles.diagnosticsPackageIcon}>
            <ShieldCheck size={16} />
          </span>
          <div className={styles.diagnosticsPackageTitle}>
            <strong>脱敏诊断 JSON</strong>
            <span>
              {exportPayload
                ? `schema v${exportPayload.schemaVersion} · ${formatTimestamp(
                    exportPayload.generatedAtIso,
                  )}`
                : "/api/diagnostics/export"}
            </span>
          </div>
        </div>
        <ul className={styles.diagnosticsPackageList}>
          <li>包含 IPC、app-server、protocol、cache 和 recent diagnostics。</li>
          <li>不包含会话正文、附件内容、密码、token、session secret。</li>
          <li>同步异常时可和 sync:doctor report 一起留存。</li>
        </ul>
        <div className={styles.settingsInlineActions}>
          <button
            className={styles.controlButton}
            type="button"
            disabled={copying || downloading}
            onClick={() => void onCopy()}
          >
            <Copy size={15} />
            {copying ? "Copying" : "Copy package"}
          </button>
          <button
            className={styles.controlButton}
            type="button"
            disabled={copying || downloading}
            onClick={() => void onDownload()}
          >
            <Download size={15} />
            {downloading ? "Downloading" : "Download package"}
          </button>
        </div>
      </div>
    </section>
  );
}

function SyncAcceptancePanel({
  selectedThreadId,
}: {
  selectedThreadId: string;
}): ReactElement {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const hasThread = selectedThreadId.trim().length > 0;

  async function copyCommand(
    kind: "send" | "steer" | "interrupt",
  ): Promise<void> {
    if (!hasThread) return;
    setMessage("");
    setError("");
    try {
      await navigator.clipboard.writeText(
        syncDoctorCommand(kind, selectedThreadId.trim()),
      );
      setMessage("已复制同步验收命令。");
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "copy sync command failed",
      );
    }
  }

  return (
    <section className={styles.diagnosticsSection}>
      <h3>Sync acceptance</h3>
      <div className={styles.syncAcceptancePanel}>
        <div className={styles.diagnosticsPackageHeader}>
          <span className={styles.diagnosticsPackageIcon}>
            <CheckCircle2 size={16} />
          </span>
          <div className={styles.diagnosticsPackageTitle}>
            <strong>三端同步验收</strong>
            <span>{hasThread ? selectedThreadId : "打开 thread 后可生成命令"}</span>
          </div>
        </div>
        <div className={styles.syncAcceptanceGrid}>
          <div className={styles.syncAcceptanceRow}>
            <div>
              <strong>发送 marker</strong>
              <span>检查 Web follower start 和 marker 唯一性</span>
            </div>
            <button
              className={styles.controlButton}
              type="button"
              disabled={!hasThread}
              aria-label="Copy sync start command"
              onClick={() => void copyCommand("send")}
            >
              <Copy size={15} />
              Copy
            </button>
          </div>
          <div className={styles.syncAcceptanceRow}>
            <div>
              <strong>引导当前</strong>
              <span>检查 active turn steer 是否走官方 follower</span>
            </div>
            <button
              className={styles.controlButton}
              type="button"
              disabled={!hasThread}
              aria-label="Copy sync steer command"
              onClick={() => void copyCommand("steer")}
            >
              <Copy size={15} />
              Copy
            </button>
          </div>
          <div className={styles.syncAcceptanceRow}>
            <div>
              <strong>停止回复</strong>
              <span>检查 interrupt 后三端状态是否一致</span>
            </div>
            <button
              className={styles.controlButton}
              type="button"
              disabled={!hasThread}
              aria-label="Copy sync interrupt command"
              onClick={() => void copyCommand("interrupt")}
            >
              <Copy size={15} />
              Copy
            </button>
          </div>
        </div>
        {!hasThread ? (
          <div className={styles.diagnosticsHint}>
            <Activity size={15} />
            <span>当前没有选中的会话。</span>
            <span />
          </div>
        ) : null}
        {message ? <div className={styles.settingsNotice}>{message}</div> : null}
        {error ? <div className={styles.settingsError}>{error}</div> : null}
      </div>
    </section>
  );
}

function RuntimeSnapshot({
  auth,
  config,
  health,
  ipc,
  appServer,
  accountStatus,
  protocolCompatibility,
  syncReadiness,
  realtimeEvents,
}: RuntimeSnapshotProps & {
  syncReadiness: SyncReadiness | null;
}): ReactElement {
  const compatibility = protocolCompatibilitySummary(protocolCompatibility);
  const followerHandlers = followerHandlerSummary(protocolCompatibility);
  const failedReadiness = syncReadiness?.checks.filter(
    (check) => check.status === "fail",
  );
  const warningReadiness = syncReadiness?.checks.filter(
    (check) => check.status === "warn",
  );

  return (
    <>
      <section className={styles.diagnosticsSummary} aria-label="运行状态摘要">
        <DiagnosticsRow
          label="Auth"
          value={auth?.authenticated ? "authenticated" : "locked"}
          detail={
            auth?.localBypass
              ? "local bypass"
              : (auth?.sessionExpiresAtIso ?? "session pending")
          }
        />
        <DiagnosticsRow
          label="HTTP"
          value={health}
          detail={
            config ? `${config.server.host}:${config.server.port}` : "loading"
          }
        />
        <DiagnosticsRow
          label="IPC"
          value={statusLabel(ipc?.connected, "connected")}
          detail={
            ipc?.clientId ??
            ipc?.lastError ??
            ipc?.pipePath ??
            "official bridge"
          }
        />
        <DiagnosticsRow
          label="App server"
          value={statusLabel(appServer?.initialized)}
          detail={
            appServer?.pid
              ? `pid ${appServer.pid} · ${appServer.pendingCallCount ?? 0} pending${appServer.lastWarning ? " · warning" : ""}`
              : (appServer?.lastError ??
                appServer?.lastWarning ??
                "not initialized")
          }
        />
        <DiagnosticsRow
          label="Compatibility"
          value={compatibility.value}
          detail={compatibility.detail}
        />
        <DiagnosticsRow
          label="Follower handlers"
          value={followerHandlers.value}
          detail={followerHandlers.detail}
        />
        <DiagnosticsRow
          label="Sync readiness"
          value={
            !syncReadiness
              ? "checking"
              : failedReadiness?.length
                ? "blocked"
                : warningReadiness?.length
                  ? "warning"
                  : "ready"
          }
          detail={
            !syncReadiness
              ? "readiness pending"
              : failedReadiness?.length
                ? `${failedReadiness.length} failed checks`
                : warningReadiness?.length
                  ? `${warningReadiness.length} warnings`
                  : "ready for live sync smoke"
          }
        />
        <DiagnosticsRow
          label="Account"
          value={
            accountStatus?.account
              ? accountStatus.account.type
              : accountStatus?.requiresOpenaiAuth
                ? "login required"
                : "unknown"
          }
          detail={
            accountStatus?.account?.email ??
            accountStatus?.account?.planType ??
            accountStatus?.warnings[0] ??
            "official account"
          }
        />
      </section>

      <section className={styles.diagnosticsSection}>
        <h3>Sync readiness</h3>
        <div className={styles.realtimeEventPanel}>
          {syncReadiness ? (
            syncReadiness.checks.map((check) => (
              <div className={styles.realtimeEventRow} key={check.id}>
                <span>
                  {check.label}: {check.detail}
                </span>
                <code>{check.status}</code>
              </div>
            ))
          ) : (
            <div className={styles.emptyDiagnostics}>
              正在检查同步 readiness。
            </div>
          )}
        </div>
      </section>

      <section className={styles.diagnosticsSection}>
        <h3>Realtime events</h3>
        <div className={styles.realtimeEventPanel}>
          {realtimeEvents.length ? (
            realtimeEvents.map((event, index) => (
              <div
                className={styles.realtimeEventRow}
                key={`${event.sequence ?? "event"}-${index}`}
              >
                <span>{event.type ?? "unknown event"}</span>
                <code>{event.sequence ?? "-"}</code>
              </div>
            ))
          ) : (
            <div className={styles.emptyDiagnostics}>等待 realtime 事件</div>
          )}
        </div>
      </section>

      <JsonBlock label="Config" value={config} />
      <JsonBlock label="Auth status" value={auth} />
      <JsonBlock label="Official account" value={accountStatus} />
      <JsonBlock label="Protocol compatibility" value={protocolCompatibility} />
      <JsonBlock
        label="Follower method capabilities"
        value={protocolCompatibility?.adapter.followerMethodCapabilities ?? []}
      />
      <JsonBlock label="IPC status" value={ipc} />
      <JsonBlock label="App-server status" value={appServer} />
    </>
  );
}

function StorageCleanupPanel({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}): ReactElement {
  const [status, setStatus] = useState<AttachmentStorageStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      setStatus(await getAttachmentStorageStatus());
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "attachment storage status failed",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function cleanUnassociated(): Promise<void> {
    const confirmed = window.confirm(
      "清理未绑定任何 thread/turn/官方引用的附件？已关联附件会永久保留。",
    );
    if (!confirmed) return;
    setCleaning(true);
    setMessage("");
    setError("");
    try {
      const result = await cleanupUnassociatedAttachments();
      await refresh();
      await onChanged();
      setMessage(
        `已清理 ${result.deletedCount} 个未关联附件，释放 ${formatBytes(result.deletedBytes)}。${
          result.skippedCount ? ` 跳过 ${result.skippedCount} 个异常路径。` : ""
        }`,
      );
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "attachment cleanup failed",
      );
    } finally {
      setCleaning(false);
    }
  }

  return (
    <section className={styles.diagnosticsSection}>
      <h3>Storage cleanup</h3>
      <div className={styles.diagnosticsSummary}>
        <DiagnosticsRow
          label="Attachments"
          value={String(status?.attachmentCount ?? 0)}
          detail={formatBytes(status?.attachmentBytes ?? 0)}
        />
        <DiagnosticsRow
          label="Unassociated"
          value={String(status?.unassociatedCount ?? 0)}
          detail={formatBytes(status?.unassociatedBytes ?? 0)}
        />
      </div>
      <div className={styles.settingsInlineActions}>
        <button
          className={styles.controlButton}
          type="button"
          disabled={loading || cleaning || !status?.unassociatedCount}
          onClick={() => void cleanUnassociated()}
        >
          <Trash2 size={15} />
          {cleaning ? "Cleaning" : "Clean unassociated"}
        </button>
        <button
          className={styles.controlButton}
          type="button"
          disabled={loading || cleaning}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
          Refresh storage
        </button>
      </div>
      {message ? <div className={styles.settingsNotice}>{message}</div> : null}
      {error ? <div className={styles.settingsError}>{error}</div> : null}
    </section>
  );
}

function AccountPanel({
  accountStatus,
}: {
  accountStatus: AccountStatus | null;
}): ReactElement {
  const primary = accountStatus?.rateLimits?.primary;
  const secondary = accountStatus?.rateLimits?.secondary;
  const credits = accountStatus?.rateLimits?.credits;
  return (
    <>
      <section className={styles.diagnosticsSection}>
        <h3>Official account</h3>
        <div className={styles.diagnosticsSummary}>
          <DiagnosticsRow
            label="Account"
            value={
              accountStatus?.account?.type ??
              (accountStatus?.requiresOpenaiAuth ? "login required" : "unknown")
            }
            detail={
              accountStatus?.account?.planType ??
              accountStatus?.warnings[0] ??
              "official app-server"
            }
          />
          <DiagnosticsRow
            label="Primary limit"
            value={
              typeof primary?.usedPercent === "number"
                ? `${primary.usedPercent}% used`
                : "unknown"
            }
            detail={
              primary?.resetsAt
                ? `resets ${new Date(primary.resetsAt).toLocaleString()}`
                : "rate limit"
            }
          />
          <DiagnosticsRow
            label="Secondary limit"
            value={
              typeof secondary?.usedPercent === "number"
                ? `${secondary.usedPercent}% used`
                : "unknown"
            }
            detail={
              secondary?.windowDurationMins
                ? `${secondary.windowDurationMins} min window`
                : "rate limit"
            }
          />
          <DiagnosticsRow
            label="Credits"
            value={
              credits?.unlimited
                ? "unlimited"
                : credits?.hasCredits
                  ? "available"
                  : "unknown"
            }
            detail={credits?.balance ?? "balance unavailable"}
          />
        </div>
      </section>
      <JsonBlock label="Account details" value={accountStatus} />
    </>
  );
}

function NetworkSettings({
  config,
  onConfigChanged,
}: {
  config: AppConfig | null;
  onConfigChanged: (config: AppConfig) => void;
}): ReactElement {
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState("18930");
  const [frontendPort, setFrontendPort] = useState("18931");
  const [lanAccess, setLanAccess] = useState<LanAccess | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingLanAccess, setLoadingLanAccess] = useState(false);

  useEffect(() => {
    if (!config) return;
    setHost(config.configured?.server.host ?? config.server.host);
    setPort(String(config.configured?.server.port ?? config.server.port));
    setFrontendPort(
      String(config.configured?.dev.frontendPort ?? config.dev.frontendPort),
    );
  }, [config]);

  async function refreshLanAccess(): Promise<void> {
    setLoadingLanAccess(true);
    setError("");
    try {
      setLanAccess(await getLanAccess());
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "lan access refresh failed",
      );
    } finally {
      setLoadingLanAccess(false);
    }
  }

  useEffect(() => {
    void refreshLanAccess();
  }, [config?.server.host, config?.server.port]);

  async function copyUrl(url: string): Promise<void> {
    setError("");
    try {
      await navigator.clipboard.writeText(url);
      setMessage("已复制局域网访问地址。");
    } catch (unknownError) {
      setError(
        unknownError instanceof Error ? unknownError.message : "copy url failed",
      );
    }
  }

  async function saveNetworkSettings(): Promise<void> {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const nextConfig = await updateSettings({
        server: { host, port: Number(port) },
        dev: { frontendPort: Number(frontendPort) },
      });
      onConfigChanged(nextConfig);
      setMessage(
        nextConfig.restartRequired
          ? "网络设置已保存，端口变更会在重启服务后生效。"
          : "网络设置已保存。",
      );
      await refreshLanAccess();
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "network settings update failed",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.diagnosticsSection}>
      <h3>Network</h3>
      <div className={styles.lanAccessPanel}>
        <div className={styles.lanAccessHeader}>
          <div>
            <strong>LAN access</strong>
            <span>手机和电脑在同一局域网时使用这些地址登录。</span>
          </div>
          <button
            className={styles.controlButton}
            type="button"
            disabled={loadingLanAccess}
            onClick={() => void refreshLanAccess()}
          >
            <RefreshCw size={15} />
            {loadingLanAccess ? "Checking" : "Refresh"}
          </button>
        </div>

        <div className={styles.lanAccessList}>
          {lanAccess?.urls.length ? (
            lanAccess.urls.map((entry) => (
              <div className={styles.lanAccessRow} key={`${entry.name}-${entry.address}`}>
                <div>
                  <strong>{entry.url}</strong>
                  <span>
                    {entry.name} · {entry.address}
                  </span>
                </div>
                <button
                  className={styles.controlButton}
                  type="button"
                  aria-label={`Copy LAN URL ${entry.url}`}
                  onClick={() => void copyUrl(entry.url)}
                >
                  <Copy size={15} />
                  Copy
                </button>
              </div>
            ))
          ) : (
            <div className={styles.diagnosticsHint}>
              <Activity size={15} />
              {loadingLanAccess
                ? "正在读取本机网卡地址..."
                : "当前没有可用于手机访问的 LAN IPv4 地址。"}
            </div>
          )}
          {lanAccess ? (
            <div className={styles.lanAccessRow}>
              <div>
                <strong>{lanAccess.localUrl}</strong>
                <span>This computer only</span>
              </div>
              <button
                className={styles.controlButton}
                type="button"
                aria-label={`Copy local URL ${lanAccess.localUrl}`}
                onClick={() => void copyUrl(lanAccess.localUrl)}
              >
                <Copy size={15} />
                Copy
              </button>
            </div>
          ) : null}
        </div>
        {lanAccess?.warnings.map((warning) => (
          <div className={styles.settingsError} key={warning}>
            {warning}
          </div>
        ))}
      </div>

      <div className={styles.settingsFormGrid}>
        <label className={styles.settingsField}>
          <span>Host</span>
          <input
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
        </label>
        <label className={styles.settingsField}>
          <span>Port</span>
          <input
            inputMode="numeric"
            value={port}
            onChange={(event) => setPort(event.target.value)}
          />
        </label>
        <label className={styles.settingsField}>
          <span>Vite port</span>
          <input
            inputMode="numeric"
            value={frontendPort}
            onChange={(event) => setFrontendPort(event.target.value)}
          />
        </label>
        <label className={styles.settingsField}>
          <span>Current bind</span>
          <input
            value={config ? `${config.server.host}:${config.server.port}` : ""}
            disabled
            readOnly
          />
        </label>
      </div>

      <div className={styles.settingsInlineActions}>
        <button
          className={styles.controlButton}
          type="button"
          disabled={saving || !config}
          onClick={() => void saveNetworkSettings()}
        >
          <CheckCircle2 size={15} />
          {saving ? "Saving" : "Save network"}
        </button>
      </div>

      {message ? <div className={styles.settingsNotice}>{message}</div> : null}
      {error ? <div className={styles.settingsError}>{error}</div> : null}
      {config?.restartRequired ? (
        <div className={styles.settingsNotice}>
          当前配置和运行端口不一致，需要重启后完全生效。
        </div>
      ) : null}
    </section>
  );
}

function PasswordSettings(): ReactElement {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  async function savePassword(): Promise<void> {
    setSavingPassword(true);
    setError("");
    setMessage("");
    try {
      if (password.length < 8) throw new Error("LAN 密码至少需要 8 个字符");
      if (password !== passwordConfirm) throw new Error("两次输入的密码不一致");
      await updateLanPassword(password);
      setPassword("");
      setPasswordConfirm("");
      setMessage("LAN 访问密码已更新。");
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "password update failed",
      );
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <section className={styles.diagnosticsSection}>
      <h3>LAN password</h3>
      <div className={styles.settingsPasswordGrid}>
        <label className={styles.settingsField}>
          <span>New LAN password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label className={styles.settingsField}>
          <span>Confirm</span>
          <input
            type="password"
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <button
          className={styles.controlButton}
          type="button"
          disabled={savingPassword || !password || !passwordConfirm}
          onClick={() => void savePassword()}
        >
          <ShieldCheck size={15} />
          {savingPassword ? "Saving" : "Update password"}
        </button>
      </div>

      {message ? <div className={styles.settingsNotice}>{message}</div> : null}
      {error ? <div className={styles.settingsError}>{error}</div> : null}
    </section>
  );
}

function AppearancePanel({
  config,
}: {
  config: AppConfig | null;
}): ReactElement {
  return (
    <section className={styles.diagnosticsSection}>
      <h3>Appearance</h3>
      <div className={styles.diagnosticsSummary}>
        <DiagnosticsRow
          label="Theme"
          value={config?.ui.theme ?? "light"}
          detail="第一版只启用浅色主题"
        />
        <DiagnosticsRow
          label="Desktop fidelity"
          value="light theme"
          detail="Dark theme deferred"
        />
      </div>
    </section>
  );
}

function DiagnosticsSettings({
  config,
  onConfigChanged,
}: {
  config: AppConfig | null;
  onConfigChanged: (config: AppConfig) => void;
}): ReactElement {
  const [rawFrameLogging, setRawFrameLogging] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!config) return;
    setRawFrameLogging(config.diagnostics.rawFrameLogging);
  }, [config]);

  async function saveDiagnosticsSettings(): Promise<void> {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const nextConfig = await updateSettings({
        diagnostics: { rawFrameLogging },
      });
      onConfigChanged(nextConfig);
      setMessage("诊断设置已保存。");
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "diagnostics settings update failed",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.diagnosticsSection}>
      <h3>Diagnostics controls</h3>
      <label className={styles.settingsCheckRow}>
        <input
          type="checkbox"
          checked={rawFrameLogging}
          onChange={(event) => setRawFrameLogging(event.target.checked)}
        />
        <span>记录官方 IPC 原始帧摘要</span>
      </label>
      <div className={styles.settingsInlineActions}>
        <button
          className={styles.controlButton}
          type="button"
          disabled={saving || !config}
          onClick={() => void saveDiagnosticsSettings()}
        >
          <CheckCircle2 size={15} />
          {saving ? "Saving" : "Save diagnostics"}
        </button>
      </div>
      {message ? <div className={styles.settingsNotice}>{message}</div> : null}
      {error ? <div className={styles.settingsError}>{error}</div> : null}
    </section>
  );
}

function SecuritySessions(): ReactElement {
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      setSessions(await getAuthSessions());
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "sessions failed",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function revokeOne(sessionId: string): Promise<void> {
    setMessage("");
    setError("");
    try {
      await revokeAuthSession(sessionId);
      await refresh();
      setMessage("Session revoked.");
    } catch (unknownError) {
      setError(
        unknownError instanceof Error ? unknownError.message : "revoke failed",
      );
    }
  }

  async function revokeOthers(): Promise<void> {
    setMessage("");
    setError("");
    try {
      const revoked = await revokeOtherAuthSessions();
      await refresh();
      setMessage(`${revoked} other session(s) revoked.`);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "revoke others failed",
      );
    }
  }

  async function revokeAll(): Promise<void> {
    const confirmed = window.confirm(
      "撤销全部 LAN session？局域网设备需要重新登录。",
    );
    if (!confirmed) return;
    setMessage("");
    setError("");
    try {
      const revoked = await revokeAllAuthSessions();
      await refresh();
      setMessage(`${revoked} session(s) revoked.`);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "revoke all failed",
      );
    }
  }

  return (
    <section className={styles.diagnosticsSection}>
      <h3>Security sessions</h3>
      <div className={styles.settingsInlineActions}>
        <button
          className={styles.controlButton}
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
          Refresh sessions
        </button>
        <button
          className={styles.controlButton}
          type="button"
          disabled={loading}
          onClick={() => void revokeOthers()}
        >
          <ShieldCheck size={15} />
          Revoke others
        </button>
        <button
          className={styles.controlButton}
          type="button"
          disabled={loading}
          onClick={() => void revokeAll()}
        >
          <X size={15} />
          Revoke all
        </button>
      </div>
      <div className={styles.sessionList}>
        {sessions.length ? (
          sessions.map((session) => (
            <div className={styles.sessionRow} key={session.id}>
              <div>
                <strong>
                  {session.current ? "Current device" : `Session ${session.id}`}
                </strong>
                <small>
                  {session.lastIp ?? "unknown ip"} ·{" "}
                  {session.userAgent ?? "unknown client"}
                </small>
                <small>
                  last seen {session.lastSeenAtIso} · expires{" "}
                  {session.expiresAtIso}
                </small>
              </div>
              <button
                className={styles.controlButton}
                type="button"
                disabled={loading}
                onClick={() => void revokeOne(session.id)}
              >
                Revoke
              </button>
            </div>
          ))
        ) : (
          <div className={styles.emptyDiagnostics}>
            没有局域网 session，本机访问会使用 local bypass。
          </div>
        )}
      </div>
      {message ? <div className={styles.settingsNotice}>{message}</div> : null}
      {error ? <div className={styles.settingsError}>{error}</div> : null}
    </section>
  );
}

function ProjectFavorites({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}): ReactElement {
  const [projects, setProjects] = useState<Project[]>([]);
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      setProjects(await getFavoriteProjects());
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "project favorites failed",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function addProject(): Promise<void> {
    if (!path.trim()) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      setProjects(await addFavoriteProject(path.trim()));
      setPath("");
      await onChanged();
      setMessage("项目收藏已更新，并已尝试同步到 Desktop。");
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "add project failed",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeProject(project: Project): Promise<void> {
    const target = project.path ?? project.id;
    const confirmed = window.confirm(`移除收藏项目“${project.name}”？`);
    if (!confirmed) return;
    setMessage("");
    setError("");
    try {
      setProjects(await removeFavoriteProject(target));
      await onChanged();
      setMessage("项目收藏已移除。");
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "remove project failed",
      );
    }
  }

  return (
    <section className={styles.diagnosticsSection}>
      <h3>项目收藏</h3>
      <div className={styles.settingsProjectGrid}>
        <label className={styles.settingsField}>
          <span>Windows 路径</span>
          <input
            value={path}
            placeholder="C:\\workspace\\codex_web"
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <button
          className={styles.controlButton}
          type="button"
          disabled={saving || !path.trim()}
          onClick={() => void addProject()}
        >
          <Plus size={15} />
          {saving ? "添加中" : "添加"}
        </button>
        <button
          className={styles.controlButton}
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
          刷新
        </button>
      </div>
      <div className={styles.sessionList}>
        {projects.length ? (
          projects.map((project) => (
            <div className={styles.sessionRow} key={project.id}>
              <div>
                <strong>{project.name}</strong>
                <small>{project.path ?? project.id}</small>
                <small>
                  {project.source === "web-favorite"
                    ? "Web 添加项目"
                    : "官方项目"}
                </small>
              </div>
              <button
                className={styles.controlButton}
                type="button"
                aria-label={`移除收藏项目 ${project.name}`}
                onClick={() => void removeProject(project)}
              >
                <Trash2 size={15} />
                移除
              </button>
            </div>
          ))
        ) : (
          <div className={styles.emptyDiagnostics}>
            <Folder size={15} />
            <span>还没有项目收藏。</span>
          </div>
        )}
      </div>
      {message ? <div className={styles.settingsNotice}>{message}</div> : null}
      {error ? <div className={styles.settingsError}>{error}</div> : null}
    </section>
  );
}

export function SettingsDiagnosticsPanel({
  open,
  onClose,
  onRefresh,
  onConfigChanged,
  auth,
  config,
  health,
  ipc,
  appServer,
  accountStatus,
  protocolCompatibility,
  selectedThreadId,
  realtimeEvents,
}: SettingsDiagnosticsPanelProps): ReactElement | null {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [copyError, setCopyError] = useState("");
  const [syncReadiness, setSyncReadiness] = useState<SyncReadiness | null>(
    null,
  );
  const [lastDiagnosticsExport, setLastDiagnosticsExport] =
    useState<DiagnosticsExport | null>(null);

  async function loadDiagnosticsExport(): Promise<DiagnosticsExport> {
    const payload = await getDiagnosticsExport();
    setLastDiagnosticsExport(payload);
    return payload;
  }

  async function copyDiagnostics(): Promise<void> {
    setCopying(true);
    setCopyMessage("");
    setCopyError("");
    try {
      const payload = await loadDiagnosticsExport();
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopyMessage("已复制脱敏排障包 JSON。");
    } catch (unknownError) {
      setCopyError(
        unknownError instanceof Error
          ? unknownError.message
          : "copy diagnostics failed",
      );
    } finally {
      setCopying(false);
    }
  }

  async function downloadDiagnostics(): Promise<void> {
    setDownloading(true);
    setCopyMessage("");
    setCopyError("");
    try {
      const payload = await loadDiagnosticsExport();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = diagnosticsFilename(payload.generatedAtIso);
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setCopyMessage("已下载脱敏排障包 JSON。");
    } catch (unknownError) {
      setCopyError(
        unknownError instanceof Error
          ? unknownError.message
          : "download diagnostics failed",
      );
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    getSyncReadiness({ threadId: selectedThreadId || null })
      .then((readiness) => {
        if (!disposed) setSyncReadiness(readiness);
      })
      .catch(() => {
        if (!disposed) setSyncReadiness(null);
      });
    return () => {
      disposed = true;
    };
  }, [open, selectedThreadId, protocolCompatibility?.summary.state]);

  if (!open) return null;

  return (
    <div
      className={styles.settingsLayer}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-diagnostics-title"
    >
      <button
        className={styles.settingsScrim}
        type="button"
        aria-label="关闭设置与诊断"
        onClick={onClose}
      />
      <aside className={styles.settingsPanel}>
        <header className={styles.settingsHeader}>
          <span className={styles.settingsIcon}>
            <Settings size={18} />
          </span>
          <div>
            <h2 id="settings-diagnostics-title">Settings / Diagnostics</h2>
            <p>Web 设置与运行诊断</p>
          </div>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="关闭设置与诊断"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className={styles.settingsActions} aria-label="未来操作">
          <button
            className={styles.controlButton}
            type="button"
            onClick={() => void onRefresh()}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
          <button className={styles.controlButton} type="button" disabled>
            <ShieldCheck size={15} />
            Auth
          </button>
        </div>

        <div
          className={styles.settingsTabs}
          role="tablist"
          aria-label="设置分类"
        >
          {SETTINGS_TABS.map((tab) => (
            <button
              className={
                activeTab === tab.id
                  ? styles.settingsTabActive
                  : styles.settingsTab
              }
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={styles.settingsBody}>
          {copyMessage ? (
            <div className={styles.settingsNotice}>{copyMessage}</div>
          ) : null}
          {copyError ? (
            <div className={styles.settingsError}>{copyError}</div>
          ) : null}

          {activeTab === "general" ? (
            <>
              <section className={styles.diagnosticsSection}>
                <h3>Overview</h3>
                <div className={styles.diagnosticsHint}>
                  <Activity size={15} />
                  <span>
                    本机免登录；局域网访问使用密码和 7 天
                    session。端口配置保存后需要重启服务。
                  </span>
                  <CheckCircle2 size={15} />
                </div>
              </section>
              <StorageCleanupPanel onChanged={onRefresh} />
            </>
          ) : null}

          {activeTab === "projects" ? (
            <ProjectFavorites onChanged={onRefresh} />
          ) : null}
          {activeTab === "security" ? (
            <>
              <PasswordSettings />
              <SecuritySessions />
            </>
          ) : null}
          {activeTab === "network" ? (
            <NetworkSettings
              config={config}
              onConfigChanged={onConfigChanged}
            />
          ) : null}
          {activeTab === "appearance" ? (
            <AppearancePanel config={config} />
          ) : null}
          {activeTab === "account" ? (
            <AccountPanel accountStatus={accountStatus} />
          ) : null}
          {activeTab === "diagnostics" ? (
            <>
              <TroubleshootingPackage
                exportPayload={lastDiagnosticsExport}
                copying={copying}
                downloading={downloading}
                onCopy={copyDiagnostics}
                onDownload={downloadDiagnostics}
              />
              <SyncAcceptancePanel selectedThreadId={selectedThreadId} />
              <DiagnosticsSettings
                config={config}
                onConfigChanged={onConfigChanged}
              />
              <RuntimeSnapshot
                auth={auth}
                config={config}
                health={health}
                ipc={ipc}
                appServer={appServer}
                accountStatus={accountStatus}
                protocolCompatibility={protocolCompatibility}
                selectedThreadId={selectedThreadId}
                syncReadiness={syncReadiness}
                realtimeEvents={realtimeEvents}
              />
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
