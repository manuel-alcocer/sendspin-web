import "./style.css";

import {
  SendspinPlayer,
  type ControllerCommand,
  type ControllerCommands,
  type GroupUpdatePayload,
  type ServerStatePayload,
} from "@sendspin/sendspin-js";
import { registerSW } from "virtual:pwa-register";

import { loadSettings, normalizeServerUrl, saveSettings, type Settings } from "./settings";

declare const __APP_VERSION__: string;

type View = "player" | "servers" | "start" | "pairing";
type Status = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

const VOLUME_STEP = 5;
const DELAY_STEP_MS = 10;
const DELAY_LIMIT_MS = 5000;

const settings: Settings = loadSettings();
let player: SendspinPlayer | null = null;
let serverState: ServerStatePayload = {};
let groupState: GroupUpdatePayload = {};
let status: Status = "idle";
let statusDetail = "";
let view: View = "start";
let selectedServer = 0;

// ---------- DOM ----------

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const views: Record<View, HTMLElement> = {
  player: $("player-view"),
  servers: $("servers-view"),
  start: $("start-view"),
  pairing: $("pairing-view"),
};

function setText(id: string, text: string, className?: string): void {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
  if (className !== undefined && el.dataset.cls !== className) {
    el.classList.remove("ok", "warn", "err", "teal", "dim", "strong");
    for (const cls of className.split(" ").filter(Boolean)) el.classList.add(cls);
    el.dataset.cls = className;
  }
}

function showView(next: View): void {
  view = next;
  for (const [name, el] of Object.entries(views)) el.hidden = name !== next;
  if (next === "servers") renderServers();
}

// ---------- formatting ----------

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--:--";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatRate(hz: number): string {
  return `${(hz / 1000).toFixed(1)}kHz`;
}

function formatChannels(n: number): string {
  if (n === 1) return "Mono";
  if (n === 2) return "Stereo";
  return `${n} ch`;
}

function formatDelay(ms: number): string {
  return `${ms >= 0 ? "+" : ""}${ms}ms`;
}

function hostOf(url: string | null): string {
  if (!url) return "—";
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/sendspin" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

/** Measure how many monospace characters fit in an element. */
function charsThatFit(el: HTMLElement): number {
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(20);
  probe.style.visibility = "hidden";
  probe.style.position = "absolute";
  el.appendChild(probe);
  const charWidth = probe.getBoundingClientRect().width / 20;
  probe.remove();
  return charWidth > 0 ? Math.floor(el.clientWidth / charWidth) : 40;
}

// ---------- rendering ----------

function supports(command: ControllerCommand): boolean {
  return serverState.controller?.supported_commands.includes(command) ?? false;
}

function isPlaying(): boolean {
  return groupState.playback_state === "playing";
}

function progress(): { positionMs: number; durationMs: number } | null {
  const fromPlayer = player?.trackProgress;
  if (fromPlayer && fromPlayer.durationMs > 0) return fromPlayer;
  const meta = serverState.metadata?.progress;
  if (!meta || !meta.track_duration) return null;
  return { positionMs: meta.track_progress, durationMs: meta.track_duration };
}

function renderProgress(): void {
  const bar = $("progress-bar");
  const p = progress();
  const width = Math.max(10, charsThatFit(bar) - 2);
  const ratio = p ? Math.min(1, Math.max(0, p.positionMs / p.durationMs)) : 0;
  const filled = Math.round(ratio * width);
  const done = filled > 0 ? `${"=".repeat(filled - 1)}>` : "";
  const rest = "-".repeat(Math.max(0, width - filled));
  const html = `[<span class="done">${done}</span>${rest}]`;
  if (bar.innerHTML !== html) bar.innerHTML = html;
  setText(
    "progress-time",
    p ? `${formatTime(p.positionMs)} / ${formatTime(p.durationMs)}` : "--:-- / --:--",
  );
}

function renderStatus(): void {
  const connected = player?.isConnected ?? false;
  if (connected && (status === "connecting" || status === "reconnecting")) status = "connected";
  const map: Record<Status, [string, string]> = {
    idle: ["Not connected", "warn"],
    connecting: ["Connecting…", "warn"],
    connected: ["Connected", "ok"],
    reconnecting: [`Reconnecting${statusDetail ? ` (${statusDetail})` : "…"}`, "warn"],
    disconnected: ["Disconnected", "err"],
    error: [statusDetail || "Error", "err"],
  };
  const [text, cls] = map[status];
  setText("status", text, cls);
  setText("host", hostOf(settings.current), "teal");
  setText("group-name", groupState.group_name || "—", "teal");
  setText("mode", settings.audio ? "this device" : "remote only", "teal");
}

function render(): void {
  const meta = serverState.metadata;
  const ctrl = serverState.controller;

  setText("title", meta?.title || "—");
  setText("artist", meta?.artist || meta?.album_artist || "—");
  setText("album", meta?.album || "—");
  setText("play-label", isPlaying() ? "pause" : "play");

  setText("group-volume", ctrl ? `${ctrl.volume}%${ctrl.muted ? " (muted)" : ""}` : "—");
  setText(
    "player-volume",
    settings.audio && player ? `${player.volume}%${player.muted ? " (muted)" : ""}` : "—",
  );

  setText("repeat", ctrl ? ctrl.repeat : "—");
  setText("shuffle", ctrl ? (ctrl.shuffle ? "on" : "off") : "—");

  const fmt = settings.audio ? (player?.currentFormat ?? null) : null;
  setText("codec", fmt ? fmt.codec.toUpperCase() : "—");
  setText("rate", fmt ? formatRate(fmt.sample_rate) : "—");
  setText("depth", fmt ? `${fmt.bit_depth}bit` : "—");
  setText("channels", fmt ? formatChannels(fmt.channels) : "—");
  setText("delay", settings.audio ? formatDelay(settings.delayMs) : "—");

  // Disable what this connection can not do right now.
  const disable = (action: string, off: boolean): void => {
    for (const el of document.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`)) {
      el.disabled = off;
    }
  };
  disable("previous", !supports("previous"));
  disable("next", !supports("next"));
  disable("toggle-play", !(supports("play") || supports("pause")));
  disable("switch", !supports("switch"));
  disable("group-up", !supports("volume"));
  disable("group-down", !supports("volume"));
  disable("group-mute", !supports("mute"));
  disable("repeat", !(supports("repeat_all") || supports("repeat_one") || supports("repeat_off")));
  disable("shuffle", !(supports("shuffle") || supports("unshuffle")));
  disable("seek", !supports("seek"));
  for (const action of ["player-up", "player-down", "player-mute", "delay-up", "delay-down"]) {
    disable(action, !settings.audio || !player);
  }

  renderStatus();
  renderProgress();
  updateMediaSession();
}

// ---------- media session (lock screen / notification controls) ----------

let mediaSessionKey = "";

function updateMediaSession(): void {
  if (!("mediaSession" in navigator)) return;
  const meta = serverState.metadata;
  const key = `${meta?.title}|${meta?.artist}|${meta?.album}|${meta?.artwork_url}`;
  if (key !== mediaSessionKey) {
    mediaSessionKey = key;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta?.title ?? "",
      artist: meta?.artist ?? meta?.album_artist ?? "",
      album: meta?.album ?? "",
      artwork: meta?.artwork_url ? [{ src: meta.artwork_url }] : [],
    });
  }
  navigator.mediaSession.playbackState = isPlaying() ? "playing" : "paused";
  const p = progress();
  if (p && p.durationMs > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration: p.durationMs / 1000,
        position: Math.min(p.positionMs, p.durationMs) / 1000,
        playbackRate: 1,
      });
    } catch {
      // some browsers reject position updates while metadata changes
    }
  }
}

function setupMediaSession(): void {
  if (!("mediaSession" in navigator)) return;
  const handlers: Array<[MediaSessionAction, () => void]> = [
    ["play", () => command("play")],
    ["pause", () => command("pause")],
    ["previoustrack", () => command("previous")],
    ["nexttrack", () => command("next")],
  ];
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // action not supported by this browser
    }
  }
}

// ---------- connection ----------

function teardown(): void {
  if (!player) return;
  try {
    player.destroy();
  } catch {
    // already gone
  }
  player = null;
  serverState = {};
  groupState = {};
}

/** Connect to the current server. Call from a user gesture when audio is on. */
async function connect(): Promise<void> {
  const url = settings.current;
  if (!url) {
    showView("servers");
    return;
  }
  teardown();
  status = "connecting";
  statusDetail = "";
  const created = new SendspinPlayer({
    url,
    clientName: settings.clientName,
    productName: "Sendspin Web",
    manufacturer: "sendspin-web",
    softwareVersion: __APP_VERSION__,
    playerRole: settings.audio,
    syncDelay: settings.delayMs,
    reconnect: {
      onReconnecting: (attempt) => {
        status = "reconnecting";
        statusDetail = `attempt ${attempt}`;
        render();
      },
      onReconnected: () => {
        status = "connected";
        render();
      },
      onExhausted: () => {
        status = "disconnected";
        render();
      },
    },
    onStateChange: (state) => {
      if (state.serverState) serverState = state.serverState;
      if (state.groupState) groupState = state.groupState;
      render();
    },
    onPairingCode: (code) => {
      if (code) {
        setText("pairing-code", code);
        showView("pairing");
      } else if (view === "pairing") {
        showView("player");
      }
    },
    onPairing: (event) => {
      if ((event === "finalized" || event === "aborted") && view === "pairing") showView("player");
    },
  });
  player = created;
  showView("player");
  render();
  try {
    if (settings.audio) await created.unlock();
    await created.connect();
    if (player === created) status = "connected";
  } catch (err) {
    if (player === created) {
      status = "error";
      statusDetail = err instanceof Error ? err.message : String(err);
      console.error("Sendspin connect failed", err);
    }
  }
  render();
}

function quit(): void {
  if (player) {
    try {
      player.disconnect("user_request");
    } catch {
      // ignore
    }
  }
  teardown();
  status = "disconnected";
  setText("start-text", "Disconnected. Tap or press any key to reconnect.");
  showView("start");
}

// ---------- actions ----------

function command<C extends ControllerCommand>(name: C, params?: ControllerCommands[C]): void {
  if (!player || !supports(name)) return;
  try {
    (player.sendCommand as (c: C, p?: ControllerCommands[C]) => void)(name, params);
  } catch (err) {
    console.warn(`Command ${name} failed`, err);
  }
}

function clampVolume(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function changeGroupVolume(delta: number): void {
  const ctrl = serverState.controller;
  if (!ctrl) return;
  command("volume", { volume: clampVolume(ctrl.volume + delta) });
}

function changePlayerVolume(delta: number): void {
  if (!player || !settings.audio) return;
  player.setVolume(clampVolume(player.volume + delta));
  render();
}

function changeDelay(delta: number): void {
  if (!settings.audio) return;
  settings.delayMs = Math.max(-DELAY_LIMIT_MS, Math.min(DELAY_LIMIT_MS, settings.delayMs + delta));
  saveSettings(settings);
  player?.setSyncDelay(settings.delayMs);
  render();
}

function cycleRepeat(): void {
  const next = { off: "repeat_all", all: "repeat_one", one: "repeat_off" } as const;
  command(next[serverState.controller?.repeat ?? "off"]);
}

function seekTo(event: MouseEvent): void {
  const p = progress();
  if (!p || !supports("seek")) return;
  const bar = $("progress-bar");
  const rect = bar.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  command("seek", { position_ms: Math.round(ratio * p.durationMs) });
}

function toggleAudio(): void {
  settings.audio = !settings.audio;
  saveSettings(settings);
  void connect();
}

const actions: Record<string, (event?: MouseEvent) => void> = {
  previous: () => command("previous"),
  next: () => command("next"),
  "toggle-play": () => command(isPlaying() ? (supports("pause") ? "pause" : "stop") : "play"),
  switch: () => command("switch"),
  "player-up": () => changePlayerVolume(VOLUME_STEP),
  "player-down": () => changePlayerVolume(-VOLUME_STEP),
  "player-mute": () => {
    if (player && settings.audio) {
      player.setMuted(!player.muted);
      render();
    }
  },
  "group-up": () => changeGroupVolume(VOLUME_STEP),
  "group-down": () => changeGroupVolume(-VOLUME_STEP),
  "group-mute": () => {
    const ctrl = serverState.controller;
    if (ctrl) command("mute", { mute: !ctrl.muted });
  },
  repeat: cycleRepeat,
  shuffle: () => command(serverState.controller?.shuffle ? "unshuffle" : "shuffle"),
  "delay-up": () => changeDelay(DELAY_STEP_MS),
  "delay-down": () => changeDelay(-DELAY_STEP_MS),
  seek: (event) => {
    if (event) seekTo(event);
  },
  servers: () => showView("servers"),
  "close-servers": () => showView(player ? "player" : "start"),
  audio: toggleAudio,
  quit,
  start: () => void connect(),
  "cancel-pairing": () => {
    player?.cancelPairing();
    showView("player");
  },
};

function flash(action: string): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-action="${action}"]`)) {
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 150);
  }
}

function run(action: string, event?: MouseEvent): void {
  const handler = actions[action];
  if (!handler) return;
  flash(action);
  handler(event);
}

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target || (target as HTMLButtonElement).disabled) return;
  run(target.dataset.action ?? "", event);
});

// ---------- server selection ----------

function renderServers(): void {
  const list = $("server-list");
  list.replaceChildren();
  if (settings.servers.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No servers yet. Add one below.";
    list.append(li);
  }
  selectedServer = Math.min(selectedServer, Math.max(0, settings.servers.length - 1));
  settings.servers.forEach((url, index) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.tabIndex = 0;
    li.setAttribute("aria-selected", String(index === selectedServer));
    const marker = document.createElement("span");
    marker.className = "marker";
    marker.textContent = index === selectedServer ? "›" : " ";
    const label = document.createElement("span");
    label.textContent = url + (url === settings.current ? "  (current)" : "");
    li.append(marker, label);
    li.addEventListener("click", () => {
      selectedServer = index;
      chooseServer(url);
    });
    list.append(li);
  });
  ($("client-name") as HTMLInputElement).value = settings.clientName;
}

function chooseServer(url: string): void {
  settings.current = url;
  settings.servers = [url, ...settings.servers.filter((s) => s !== url)];
  selectedServer = 0;
  saveSettings(settings);
  void connect();
}

function updateClientName(): boolean {
  const name = ($("client-name") as HTMLInputElement).value.trim();
  if (!name || name === settings.clientName) return false;
  settings.clientName = name;
  saveSettings(settings);
  return true;
}

$("server-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("server-url") as HTMLInputElement;
  const renamed = updateClientName();
  if (!input.value.trim()) {
    if (renamed && settings.current) void connect();
    return;
  }
  const url = normalizeServerUrl(input.value);
  if (!url) {
    input.setCustomValidity("Enter a ws:// or wss:// URL");
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  input.value = "";
  chooseServer(url);
});

$("client-name").addEventListener("change", () => {
  if (updateClientName() && player) void connect();
});

// ---------- keyboard (same keys as the CLI) ----------

const keymap: Record<string, string> = {
  ArrowLeft: "previous",
  ArrowRight: "next",
  " ": "toggle-play",
  g: "switch",
  ArrowUp: "player-up",
  ArrowDown: "player-down",
  m: "player-mute",
  "]": "group-up",
  "[": "group-down",
  M: "group-mute",
  r: "repeat",
  x: "shuffle",
  ".": "delay-up",
  ",": "delay-down",
  s: "servers",
  a: "audio",
  q: "quit",
};

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const inInput = (event.target as HTMLElement).closest("input, textarea");

  if (view === "start") {
    if (!inInput) {
      event.preventDefault();
      void connect();
    }
    return;
  }

  if (view === "pairing") {
    if (event.key === "Escape") run("cancel-pairing");
    return;
  }

  if (view === "servers") {
    if (event.key === "Escape") {
      event.preventDefault();
      run("close-servers");
      return;
    }
    if (inInput) return;
    const count = settings.servers.length;
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      selectedServer = (selectedServer + 1) % count;
      renderServers();
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      selectedServer = (selectedServer - 1 + count) % count;
      renderServers();
    } else if (event.key === "Enter" && count) {
      event.preventDefault();
      chooseServer(settings.servers[selectedServer]);
    } else if ((event.key === "Delete" || event.key === "Backspace") && count) {
      event.preventDefault();
      const removed = settings.servers.splice(selectedServer, 1)[0];
      if (removed === settings.current) settings.current = null;
      saveSettings(settings);
      renderServers();
    }
    return;
  }

  if (inInput) return;
  const action = keymap[event.key];
  if (action) {
    event.preventDefault();
    run(action);
  }
});

// ---------- start ----------

// The start screen is one big tap target: the tap is the gesture that unlocks audio.
views.start.addEventListener("click", (event) => {
  if (!(event.target as HTMLElement).closest("[data-action]")) void connect();
});

setupMediaSession();
setInterval(() => {
  if (view === "player") {
    renderProgress();
    renderStatus();
    updateMediaSession();
  }
}, 250);
window.addEventListener("resize", () => renderProgress());

registerSW({ immediate: true });

// Audio needs a user gesture to start, a remote does not.
if (settings.current && !settings.audio) {
  void connect();
} else if (!settings.current) {
  showView("servers");
} else {
  showView("start");
}
