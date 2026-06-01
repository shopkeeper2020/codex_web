const OWNER_ACTION_MESSAGES: Record<string, string> = {
  "thread-rename":
    "这个会话当前由官方 Desktop/VS Code 持有，Web 暂时不直接重命名，避免三端状态分叉。",
  "thread-archive":
    "这个会话当前由官方 Desktop/VS Code 持有，Web 暂时不直接归档，避免三端状态分叉。",
  "thread-unarchive":
    "这个会话当前由官方 Desktop/VS Code 持有，Web 暂时不直接恢复，避免三端状态分叉。",
};

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  return "";
}

export function userFacingErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const message = rawErrorMessage(error);
  if (!message) return fallback;

  if (
    message === "official-ipc-owner-not-ready" ||
    message === "official-ipc-owner-not-established"
  ) {
    return "官方同步通道还没准备好，暂时不能创建会话。请稍后重试，或打开 Settings > Diagnostics 查看 IPC/app-server 状态。";
  }

  const ownerActionPrefix = "official-owner-action-required:";
  if (message.startsWith(ownerActionPrefix)) {
    const action = message.slice(ownerActionPrefix.length);
    return (
      OWNER_ACTION_MESSAGES[action] ??
      "这个会话当前由官方 Desktop/VS Code 持有，Web 暂时不执行这项本地变更，避免三端状态分叉。"
    );
  }

  if (message.startsWith("official-owner-required:")) {
    return "还没有确认这个会话应由哪个官方客户端执行。Web 已拒绝本地执行，避免三端状态分叉；请打开 Desktop/VS Code 中的同一会话后重试。";
  }

  if (
    message.startsWith("official-owner-unavailable:") &&
    message.includes("thread-follower-steer-turn")
  ) {
    return "当前回复的官方执行端暂时不可用，Web 不能改由本地引导当前回复，避免三端状态分叉；请确认 Desktop 或 VS Code 仍在运行并已打开该会话，或点输入框底部“当前”切到“排队”。";
  }

  if (message.startsWith("official-owner-unavailable:")) {
    return "当前会话的官方执行端暂时不可用。Web 已拒绝本地执行，避免三端状态分叉；请确认 Desktop 或 VS Code 仍在运行并已打开该会话。";
  }

  if (message.startsWith("official-ipc-request-failed:")) {
    return "官方 IPC 请求失败。请在 Settings > Diagnostics 检查协议兼容性和最近请求日志。";
  }

  if (message.startsWith("official-ipc-send-failed:")) {
    return "官方 IPC 发送失败。请确认 Desktop/VS Code 仍在运行，然后重试。";
  }

  const lowerMessage = message.toLocaleLowerCase();
  if (
    lowerMessage.includes("failed to read thread") &&
    lowerMessage.includes("rollout") &&
    lowerMessage.includes("jsonl") &&
    lowerMessage.includes("is empty")
  ) {
    return "新会话还在初始化，内容马上会同步完成。";
  }

  return message;
}
