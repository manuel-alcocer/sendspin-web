/**
 * Per-device settings kept in localStorage.
 *
 * Storage can be missing or throw (private mode, blocked site data), so every
 * access is guarded and the app keeps working with in-memory defaults.
 */

export interface Settings {
  /** Known server URLs, most recently used first. */
  servers: string[];
  /** Server to connect to, or null to ask. */
  current: string | null;
  /** Name this client announces to the server. */
  clientName: string;
  /** Play audio on this device (player role) or act as a remote only. */
  audio: boolean;
  /** Static output delay in milliseconds, like the CLI's ,/. keys. */
  delayMs: number;
}

const KEY = "sendspin-web:settings";

/** Same-origin `/sendspin`, which the deployment proxies to the Sendspin server. */
export function defaultServerUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/sendspin`;
}

function defaultClientName(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Browser";
  return `Sendspin Web (${device})`;
}

function defaults(): Settings {
  const url = defaultServerUrl();
  return { servers: [url], current: url, clientName: defaultClientName(), audio: true, delayMs: 0 };
}

export function loadSettings(): Settings {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const stored = JSON.parse(raw) as Partial<Settings>;
    return {
      servers: Array.isArray(stored.servers)
        ? stored.servers.filter((s): s is string => typeof s === "string")
        : base.servers,
      current: typeof stored.current === "string" ? stored.current : null,
      clientName:
        typeof stored.clientName === "string" && stored.clientName.trim()
          ? stored.clientName
          : base.clientName,
      audio: typeof stored.audio === "boolean" ? stored.audio : base.audio,
      delayMs: typeof stored.delayMs === "number" ? stored.delayMs : base.delayMs,
    };
  } catch {
    return base;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: settings live for this session only
  }
}

/** Return the URL normalized, or null when it is not a ws:// or wss:// URL. */
export function normalizeServerUrl(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z]+:\/\//i.test(text)) text = `${location.protocol === "https:" ? "wss" : "ws"}://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    if (url.pathname === "/" || url.pathname === "") url.pathname = "/sendspin";
    return url.toString();
  } catch {
    return null;
  }
}
