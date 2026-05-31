import {
  Archive,
  ChevronDown,
  Code2,
  FolderOpen,
  ListChecks,
  Folder,
  Menu,
  MoreHorizontal,
  PanelBottom,
  PanelRight,
  Pin,
  Settings,
  Square,
  SquarePen,
  TerminalSquare,
} from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import type { AppServerStatus, OfficialIpcStatus, Thread } from "../../api";
import { useI18n } from "../../i18n/useI18n";
import styles from "../App.module.css";
import { StatusBadge, type StatusTone } from "./StatusBadge";

function projectDisplayName(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

function statusTone(
  ok: boolean | undefined,
  idleWhenUnknown = false,
): StatusTone {
  if (ok === true) return "ready";
  if (ok === undefined && idleWhenUnknown) return "idle";
  return "warn";
}

function RuntimeStrip({
  health,
  ipc,
  appServer,
}: {
  health: string;
  ipc: OfficialIpcStatus | null;
  appServer: AppServerStatus | null;
}): ReactElement {
  return (
    <div className={styles.runtimeStrip} aria-label="同步状态">
      <StatusBadge
        label={`server ${health}`}
        tone={health === "ready" ? "ready" : "warn"}
      />
      <StatusBadge
        label={ipc?.connected ? "Desktop connected" : "Desktop offline"}
        tone={statusTone(ipc?.connected)}
      />
      <StatusBadge
        label={appServer?.initialized ? "app-server ready" : "app-server idle"}
        tone={statusTone(appServer?.initialized, true)}
      />
    </div>
  );
}

export function Header({
  health,
  ipc,
  appServer,
  selectedThread,
  draftProjectName,
  onOpenDrawer,
  onOpenSearch,
  onOpenSettings,
  onRenameThread,
  onArchiveThread,
  onInterruptTurn,
  pinnedSummaryOpen,
  rightSidebarOpen,
  bottomTerminalOpen,
  onTogglePinnedSummary,
  onToggleRightSidebar,
  onToggleBottomTerminal,
}: {
  health: string;
  ipc: OfficialIpcStatus | null;
  appServer: AppServerStatus | null;
  selectedThread: Thread | null;
  draftProjectName?: string | null;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onRenameThread: () => void;
  onArchiveThread: () => void;
  onInterruptTurn: () => void;
  pinnedSummaryOpen: boolean;
  rightSidebarOpen: boolean;
  bottomTerminalOpen: boolean;
  onTogglePinnedSummary: () => void;
  onToggleRightSidebar: () => void;
  onToggleBottomTerminal: () => void;
}): ReactElement {
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const draftMode = draftProjectName !== undefined;
  const projectName = draftMode
    ? (draftProjectName ?? "无项目")
    : selectedThread?.projectId
      ? projectDisplayName(selectedThread.projectId)
      : "无项目";
  const title = draftMode ? "新对话" : (selectedThread?.title ?? "codex_web");
  const hasSelectedThread = Boolean(selectedThread);
  const localEnvironmentActionsEnabled = false;
  const runMobileAction = (action: () => void): void => {
    setMoreOpen(false);
    action();
  };

  return (
    <header className={styles.header}>
      <div className={styles.mobileHeaderActions}>
        <button
          className={styles.iconButton}
          type="button"
          aria-label={t("header.navigation.open")}
          onClick={onOpenDrawer}
        >
          <Menu size={19} />
        </button>
      </div>
      <div className={styles.titleBlock}>
        <div className={styles.breadcrumb}>
          <Folder size={14} />
          <span>{projectName}</span>
          <span>/</span>
          <span>{draftMode ? "新对话" : (selectedThread?.title ?? "选择会话")}</span>
        </div>
        <h1 className={styles.headerTitle}>
          {!draftMode && selectedThread?.pinned ? (
            <Pin size={14} fill="currentColor" />
          ) : null}
          <span>{title}</span>
        </h1>
      </div>
      <RuntimeStrip health={health} ipc={ipc} appServer={appServer} />
      <div className={styles.headerActions}>
        <div className={styles.desktopHeaderActions}>
          <div className={styles.desktopToolControl}>
            <button
              className={styles.localEnvironmentButton}
              type="button"
              aria-label={t("header.localEnvironment.open")}
              aria-expanded={
                localEnvironmentActionsEnabled && environmentOpen
              }
              disabled={!localEnvironmentActionsEnabled}
              title="本地环境操作暂未接入 Web"
              onClick={() => setEnvironmentOpen((open) => !open)}
            >
              <Code2 size={18} />
              <ChevronDown size={13} />
            </button>
            {localEnvironmentActionsEnabled && environmentOpen ? (
              <div
                className={styles.desktopToolMenu}
                role="menu"
                aria-label={t("header.localEnvironment.label")}
              >
                <button type="button" role="menuitem" disabled>
                  <Code2 size={16} />
                  <span>{t("header.localEnvironment.vscode")}</span>
                </button>
                <button type="button" role="menuitem" disabled>
                  <FolderOpen size={16} />
                  <span>{t("header.localEnvironment.fileExplorer")}</span>
                </button>
                <button type="button" role="menuitem" disabled>
                  <TerminalSquare size={16} />
                  <span>{t("header.localEnvironment.terminal")}</span>
                </button>
                <button type="button" role="menuitem" disabled>
                  <Code2 size={16} />
                  <span>{t("header.localEnvironment.wsl")}</span>
                </button>
              </div>
            ) : null}
          </div>
          <button
            className={[
              styles.iconButton,
              pinnedSummaryOpen ? styles.iconButtonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            aria-label={
              pinnedSummaryOpen
                ? t("header.pinnedSummary.collapse")
                : t("header.pinnedSummary.open")
            }
            aria-pressed={pinnedSummaryOpen}
            onClick={onTogglePinnedSummary}
          >
            <ListChecks size={17} />
          </button>
          <button
            className={[
              styles.iconButton,
              bottomTerminalOpen ? styles.iconButtonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            disabled
            title="底部终端暂未接入 Web，后续接入真实终端后启用"
            aria-label={
              bottomTerminalOpen
                ? t("header.bottomTerminal.collapse")
                : t("header.bottomTerminal.open")
            }
            aria-pressed={bottomTerminalOpen}
            onClick={onToggleBottomTerminal}
          >
            <PanelBottom size={17} />
          </button>
          <button
            className={[
              styles.iconButton,
              rightSidebarOpen ? styles.iconButtonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            aria-label={
              rightSidebarOpen
                ? t("header.rightSidebar.collapse")
                : t("header.rightSidebar.open")
            }
            aria-pressed={rightSidebarOpen}
            onClick={onToggleRightSidebar}
          >
            <PanelRight size={17} />
          </button>
        </div>
        <div className={styles.mobileMoreControl}>
          <button
            className={styles.iconButton}
            type="button"
            aria-label={t("header.mobile.more")}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <MoreHorizontal size={18} />
          </button>
          {moreOpen ? (
            <div
              className={styles.mobileHeaderMenu}
              role="menu"
              aria-label={t("header.mobile.threadActions")}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => runMobileAction(onOpenSearch)}
              >
                <Menu size={15} />
                <span>{t("header.mobile.search")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => runMobileAction(onTogglePinnedSummary)}
              >
                <ListChecks size={15} />
                <span>
                  {pinnedSummaryOpen
                    ? t("header.pinnedSummary.collapse")
                    : t("header.pinnedSummary.open")}
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => runMobileAction(onToggleRightSidebar)}
              >
                <PanelRight size={15} />
                <span>
                  {rightSidebarOpen
                    ? t("header.rightSidebar.collapse")
                    : t("header.rightSidebar.open")}
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!hasSelectedThread}
                onClick={() => runMobileAction(onRenameThread)}
              >
                <SquarePen size={15} />
                <span>{t("header.mobile.rename")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!hasSelectedThread}
                onClick={() => runMobileAction(onArchiveThread)}
              >
                <Archive size={15} />
                <span>{t("header.mobile.archive")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!selectedThread?.inProgress}
                onClick={() => runMobileAction(onInterruptTurn)}
              >
                <Square size={14} />
                <span>{t("header.mobile.stop")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => runMobileAction(onOpenSettings)}
              >
                <Settings size={15} />
                <span>{t("header.mobile.settings")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
