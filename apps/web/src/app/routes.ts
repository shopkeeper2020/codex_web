export const ROUTE_CHANGE_EVENT = "codex-web-route";

export type AppRoute = "chat" | "settings" | "debug";

export function readThreadIdFromPath(): string {
  const match = window.location.pathname.match(/^\/thread\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export function readThreadIdFromHash(): string {
  const match = window.location.hash.match(/^#\/thread\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export function readThreadIdFromLocation(): string {
  return readThreadIdFromPath() || readThreadIdFromHash();
}

export function readAppRouteFromLocation(): AppRoute {
  if (window.location.pathname.startsWith("/debug")) return "debug";
  if (window.location.pathname.startsWith("/settings")) return "settings";
  return "chat";
}

export function threadRoute(threadId: string): string {
  return threadId ? `/thread/${encodeURIComponent(threadId)}` : "/";
}

export function replaceAppPath(path: string): void {
  if (window.location.pathname === path && !window.location.hash) return;
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

export function replaceRoute(threadId: string): void {
  replaceAppPath(threadRoute(threadId));
}
