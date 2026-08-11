export const REMOTE_SUPPORT_PROTOCOL = 3;

export const REMOTE_SUPPORT_TASKS = Object.freeze([
  "automatic_usb_recovery",
  "automatic_apply",
  "bluetooth_probe",
  "bluetooth_recovery",
]);

export const REMOTE_TASK_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const MAX_REMOTE_DEPTH = 12;
const MAX_REMOTE_STRING_LENGTH = 24_000;

export function remoteSupportAllowsDirectWebUsb(
  supportState,
  webUsbAvailable,
) {
  return Boolean(
    webUsbAvailable &&
      supportState?.status === "connected" &&
      supportState?.role === "device",
  );
}

export function remoteSupportWebSocketUrl(locationLike = window.location) {
  const configured =
    typeof import.meta !== "undefined"
      ? String(import.meta.env?.VITE_REMOTE_SUPPORT_URL ?? "").trim()
      : "";
  if (configured) return configured;
  const scheme = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${locationLike.host}/remote-support/ws`;
}

export function remoteJsonValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > MAX_REMOTE_STRING_LENGTH
      ? `${value.slice(0, MAX_REMOTE_STRING_LENGTH)}…`
      : value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );
    return {
      type: "bytes",
      byteLength: bytes.byteLength,
      hex: [...bytes]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    };
  }
  if (value instanceof ArrayBuffer) {
    return remoteJsonValue(new Uint8Array(value), depth, seen);
  }
  if (depth >= MAX_REMOTE_DEPTH) return "[depth limit]";
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) {
      const result = value.map((entry) =>
        remoteJsonValue(entry, depth + 1, seen),
      );
      seen.delete(value);
      return result;
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      const safe = remoteJsonValue(entry, depth + 1, seen);
      if (safe !== undefined) result[key] = safe;
    }
    seen.delete(value);
    return result;
  }
  return String(value);
}

export function makeRemoteMessageId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `command_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export class RemoteSupportConnection {
  constructor({
    url = remoteSupportWebSocketUrl(),
    WebSocketImpl = WebSocket,
    onMessage = () => {},
    onState = () => {},
  } = {}) {
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.onMessage = onMessage;
    this.onState = onState;
    this.socket = null;
    this.role = null;
    this.session = null;
    this.resumeToken = null;
    this.userClosed = false;
    this.messageListeners = new Set();
    this.pendingTasks = new Map();
  }

  async connect(hello) {
    this.close();
    this.userClosed = false;
    this.role = hello.role;
    this.onState({ status: "connecting", role: hello.role });
    const socket = new this.WebSocketImpl(this.url);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const timeout = setTimeout(() => {
        fail(new Error("The remote-support relay did not complete its handshake."));
        socket.close();
      }, 10_000);

      socket.addEventListener("open", () => {
        socket.send(
          JSON.stringify({
            type: "hello",
            protocol: REMOTE_SUPPORT_PROTOCOL,
            ...hello,
          }),
        );
      });
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ready") {
            clearTimeout(timeout);
            settled = true;
            this.session = message.session;
            this.resumeToken = message.resumeToken ?? this.resumeToken;
            // Older relays omit the field; a null list disables every
            // capability-gated serial fast path without probing.
            this.serialOperations = Array.isArray(message.serialOperations)
              ? message.serialOperations.filter(
                  (value) => typeof value === "string",
                )
              : null;
            this.tasks = Array.isArray(message.tasks)
              ? message.tasks.filter((value) => typeof value === "string")
              : null;
            this.onState({
              status: "connected",
              role: this.role,
              session: this.session,
            });
            resolve(message);
            return;
          }
          if (!settled && message.type === "error") {
            clearTimeout(timeout);
            fail(new Error(message.error));
            return;
          }
          if (message.type === "task_result") {
            const pending = this.pendingTasks.get(message.id);
            if (pending) {
              clearTimeout(pending.timer);
              this.pendingTasks.delete(message.id);
              if (message.ok) pending.resolve(message.result);
              else pending.reject(new Error(message.error));
            }
          }
          this.onMessage(message);
          for (const listener of this.messageListeners) listener(message);
        } catch (error) {
          this.onState({
            status: "error",
            role: this.role,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      socket.addEventListener("error", () => {
        const error = new Error("The remote-support relay connection failed.");
        fail(error);
        this.onState({
          status: "error",
          role: this.role,
          error: error.message,
        });
      });
      socket.addEventListener("close", (event) => {
        clearTimeout(timeout);
        if (!settled) {
          fail(
            new Error(
              event.reason ||
                `The remote-support relay closed during setup (${event.code}).`,
            ),
          );
        }
        if (this.socket === socket) {
          this.socket = null;
          // Tell anything waiting on a relayed reply that no reply can
          // arrive, so it fails now with an accurate reason instead of
          // waiting out a per-request timeout. A dropped relay used to
          // surface as "Remote serial close timed out" fifteen seconds
          // later, which describes the timer rather than the cause.
          const closure = {
            type: "relay_closed",
            reason:
              event.reason ||
              (this.userClosed
                ? "The support session was closed."
                : `The remote-support relay disconnected (${event.code}).`),
          };
          for (const [id, pending] of this.pendingTasks) {
            clearTimeout(pending.timer);
            pending.reject(new Error(closure.reason));
            this.pendingTasks.delete(id);
          }
          for (const listener of this.messageListeners) {
            try {
              listener(closure);
            } catch {
              // A listener failing must not stop the others from learning.
            }
          }
          this.onState({
            status: this.userClosed ? "closed" : "disconnected",
            role: this.role,
            code: event.code,
            reason: event.reason,
            session: this.session,
          });
        }
      });
    });
  }

  startDevice({ code, resumeToken } = {}) {
    return this.connect({
      role: "device",
      ...(code && resumeToken ? { code, resumeToken } : {}),
    });
  }

  joinOperator({ code, operatorKey }) {
    return this.connect({
      role: "operator",
      code,
      operatorKey,
    });
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) {
      throw new Error("The remote-support relay is not connected.");
    }
    this.socket.send(JSON.stringify(message));
  }

  sendEvent(event, value) {
    this.send({
      type: "event",
      event,
      value: remoteJsonValue(value),
    });
  }

  sendState(value) {
    this.send({
      type: "state",
      value: remoteJsonValue(value),
    });
  }

  sendResult(id, { ok, result, error }) {
    this.send({
      type: "result",
      id,
      ok: Boolean(ok),
      ...(ok
        ? { result: remoteJsonValue(result) }
        : { error: String(error ?? "Remote diagnostic failed.") }),
    });
  }

  requestTask(task, args = {}) {
    if (this.role !== "operator") {
      return Promise.reject(
        new Error("Only the authenticated technician can request a recovery task."),
      );
    }
    if (!REMOTE_SUPPORT_TASKS.includes(task)) {
      return Promise.reject(new Error(`Unsupported remote recovery task ${task}.`));
    }
    const id = makeRemoteMessageId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTasks.delete(id);
        reject(new Error(`Remote recovery task ${task} timed out.`));
      }, REMOTE_TASK_TIMEOUT_MS);
      this.pendingTasks.set(id, { resolve, reject, timer, task });
      try {
        this.send({
          type: "task_request",
          id,
          task,
          args: remoteJsonValue(args),
        });
      } catch (error) {
        clearTimeout(timer);
        this.pendingTasks.delete(id);
        reject(error);
      }
    });
  }

  sendTaskResult(id, { ok, result, error }) {
    this.send({
      type: "task_result",
      id,
      ok: Boolean(ok),
      ...(ok
        ? { result: remoteJsonValue(result) }
        : { error: String(error ?? "Remote recovery task failed.") }),
    });
  }

  sendTaskEvent(id, event, value) {
    this.send({
      type: "task_event",
      id,
      event,
      value: remoteJsonValue(value),
    });
  }

  addMessageListener(listener) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  close() {
    this.userClosed = true;
    if (this.socket) {
      this.socket.close(1000, "Support session closed");
      this.socket = null;
    }
    for (const [id, pending] of this.pendingTasks) {
      clearTimeout(pending.timer);
      pending.reject(new Error("The support session was closed."));
      this.pendingTasks.delete(id);
    }
  }
}
