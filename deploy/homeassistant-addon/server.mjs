import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

export const REMOTE_SUPPORT_PROTOCOL = 2;
export const REMOTE_SERIAL_OPERATIONS = Object.freeze([
  "get_info",
  "open",
  "write",
  "set_signals",
  "close",
]);

const SESSION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_MAX_SESSIONS = 128;
const DEFAULT_MAX_CONNECTIONS = 256;
const MAX_PENDING_SERIAL_REQUESTS = 32;
const MAX_BASE64_SERIAL_CHARS = 24 * 1024;
const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

function send(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function closeWith(socket, code, reason) {
  if (
    socket?.readyState === WebSocket.OPEN ||
    socket?.readyState === WebSocket.CONNECTING
  ) {
    socket.close(code, reason);
  }
}

function normalizeCode(input) {
  return String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 8);
}

function displayCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function makeSessionCode(existing) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const random = randomBytes(8);
    let code = "";
    for (const byte of random) {
      code += SESSION_ALPHABET[byte % SESSION_ALPHABET.length];
    }
    if (!existing.has(code)) return code;
  }
  throw new Error("Could not allocate a unique remote-support code.");
}

function secretMatches(expected, candidate) {
  const expectedDigest = createHash("sha256").update(expected).digest();
  const candidateDigest = createHash("sha256")
    .update(String(candidate ?? ""))
    .digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}

function validMessageId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

function publicSession(session) {
  return {
    code: displayCode(session.code),
    expiresAt: new Date(session.expiresAt).toISOString(),
    deviceOnline: session.device?.readyState === WebSocket.OPEN,
    operatorOnline: session.operator?.readyState === WebSocket.OPEN,
  };
}

export function createRemoteSupportServer({
  operatorKey,
  host = "0.0.0.0",
  port = 8787,
  path = "/remote-support/ws",
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  maxPayload = DEFAULT_MAX_PAYLOAD_BYTES,
  maxSessions = DEFAULT_MAX_SESSIONS,
  maxConnections = DEFAULT_MAX_CONNECTIONS,
  logger = console,
} = {}) {
  if (typeof operatorKey !== "string" || operatorKey.length < 24) {
    throw new Error("SUPPORT_OPERATOR_KEY must contain at least 24 characters.");
  }
  if (!path.startsWith("/")) {
    throw new Error("The remote-support WebSocket path must start with /.");
  }

  const sessions = new Map();
  const connections = new WeakMap();
  const httpServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      const onlineSessions = [...sessions.values()].filter(
        (session) =>
          session.device?.readyState === WebSocket.OPEN ||
          session.operator?.readyState === WebSocket.OPEN,
      ).length;
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        `${JSON.stringify({
          ok: true,
          protocol: REMOTE_SUPPORT_PROTOCOL,
          sessions: onlineSessions,
        })}\n`,
      );
      return;
    }
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end("Not found\n");
  });
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload,
    perMessageDeflate: false,
  });

  const expireSessions = () => {
    const now = Date.now();
    for (const [code, session] of sessions) {
      if (session.expiresAt > now) continue;
      send(session.device, { type: "expired" });
      send(session.operator, { type: "expired" });
      closeWith(session.device, 4008, "Support session expired");
      closeWith(session.operator, 4008, "Support session expired");
      sessions.delete(code);
    }
  };

  const touch = (session) => {
    session.expiresAt = Date.now() + sessionTtlMs;
  };

  const bindDevice = (socket, hello) => {
    const requestedCode = normalizeCode(hello.code);
    const resumeToken = String(hello.resumeToken ?? "");
    let session = requestedCode ? sessions.get(requestedCode) : null;
    if (session) {
      if (
        !resumeToken ||
        !secretMatches(session.resumeToken, resumeToken)
      ) {
        throw new Error("The device resume token is invalid.");
      }
      closeWith(session.device, 4000, "Device reconnected");
    } else {
      expireSessions();
      if (sessions.size >= maxSessions) {
        const error = new Error(
          "The remote-support relay is at its active-session limit.",
        );
        error.closeCode = 4013;
        throw error;
      }
      const code = makeSessionCode(sessions);
      session = {
        code,
        resumeToken: randomBytes(32).toString("base64url"),
        device: null,
        operator: null,
        expiresAt: Date.now() + sessionTtlMs,
        pendingSerialRequests: new Set(),
      };
      sessions.set(code, session);
    }
    session.device = socket;
    touch(session);
    connections.set(socket, { role: "device", session, alive: true });
    send(socket, {
      type: "ready",
      role: "device",
      session: publicSession(session),
      resumeToken: session.resumeToken,
    });
    send(session.operator, {
      type: "peer",
      role: "device",
      online: true,
    });
  };

  const bindOperator = (socket, hello) => {
    if (!secretMatches(operatorKey, hello.operatorKey)) {
      const error = new Error("The technician access key is invalid.");
      error.closeCode = 4003;
      throw error;
    }
    const code = normalizeCode(hello.code);
    const session = sessions.get(code);
    if (!session) {
      const error = new Error("That remote-support session was not found.");
      error.closeCode = 4004;
      throw error;
    }
    if (session.operator?.readyState === WebSocket.OPEN) {
      const error = new Error("A technician is already connected to this session.");
      error.closeCode = 4009;
      throw error;
    }
    session.operator = socket;
    touch(session);
    connections.set(socket, { role: "operator", session, alive: true });
    send(socket, {
      type: "ready",
      role: "operator",
      session: publicSession(session),
    });
    send(session.device, {
      type: "peer",
      role: "operator",
      online: true,
    });
  };

  const handleHello = (socket, message) => {
    if (
      message.protocol !== REMOTE_SUPPORT_PROTOCOL ||
      !["device", "operator"].includes(message.role)
    ) {
      throw new Error("Unsupported remote-support handshake.");
    }
    if (message.role === "device") bindDevice(socket, message);
    else bindOperator(socket, message);
  };

  const forwardDeviceMessage = (connection, message) => {
    if (
      ![
        "event",
        "state",
        "serial_result",
        "serial_data",
        "serial_event",
      ].includes(message.type)
    ) {
      throw new Error("The device sent a message type outside its allowlist.");
    }
    if (message.type === "serial_result") {
      if (
        !validMessageId(message.id) ||
        !connection.session.pendingSerialRequests.has(message.id)
      ) {
        throw new Error("The device returned an unknown serial request id.");
      }
      connection.session.pendingSerialRequests.delete(message.id);
    }
    if (
      message.type === "serial_data" &&
      (typeof message.data !== "string" ||
        message.data.length > MAX_BASE64_SERIAL_CHARS)
    ) {
      throw new Error("The device serial-data frame is outside its size limit.");
    }
    touch(connection.session);
    send(connection.session.operator, message);
  };

  const forwardOperatorMessage = (connection, message) => {
    if (
      message.type !== "serial_request" ||
      !validMessageId(message.id) ||
      !REMOTE_SERIAL_OPERATIONS.includes(message.op)
    ) {
      throw new Error(
        "The technician request is outside the single-port serial protocol.",
      );
    }
    if (connection.session.device?.readyState !== WebSocket.OPEN) {
      send(connection.session.operator, {
        type: "serial_result",
        id: message.id,
        ok: false,
        error: "The person's browser is not connected.",
      });
      return;
    }
    if (connection.session.pendingSerialRequests.has(message.id)) {
      throw new Error("The technician reused an active serial request id.");
    }
    if (
      connection.session.pendingSerialRequests.size >=
      MAX_PENDING_SERIAL_REQUESTS
    ) {
      throw new Error("Too many serial requests are awaiting the device.");
    }
    if (
      message.op === "write" &&
      (typeof message.data !== "string" ||
        message.data.length > MAX_BASE64_SERIAL_CHARS)
    ) {
      throw new Error("The technician serial write is outside its size limit.");
    }
    connection.session.pendingSerialRequests.add(message.id);
    touch(connection.session);
    send(connection.session.device, {
      type: "serial_request",
      id: message.id,
      op: message.op,
      ...(message.op === "open" ? { options: message.options } : {}),
      ...(message.op === "write" ? { data: message.data } : {}),
      ...(message.op === "set_signals" ? { signals: message.signals } : {}),
    });
  };

  webSocketServer.on("connection", (socket) => {
    connections.set(socket, { role: null, session: null, alive: true });
    const helloTimeout = setTimeout(() => {
      closeWith(socket, 4001, "Handshake timed out");
    }, HELLO_TIMEOUT_MS);

    socket.on("pong", () => {
      const connection = connections.get(socket);
      if (connection) connection.alive = true;
    });
    socket.on("message", (raw, isBinary) => {
      try {
        if (isBinary) throw new Error("Binary relay messages are not accepted.");
        const message = JSON.parse(raw.toString("utf8"));
        const connection = connections.get(socket);
        if (!connection?.role) {
          if (message.type !== "hello") {
            throw new Error("The first message must be a handshake.");
          }
          handleHello(socket, message);
          clearTimeout(helloTimeout);
          return;
        }
        if (message.type === "hello") {
          throw new Error("The connection is already authenticated.");
        }
        if (connection.role === "device") {
          forwardDeviceMessage(connection, message);
        } else {
          forwardOperatorMessage(connection, message);
        }
      } catch (error) {
        send(socket, {
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        closeWith(socket, error.closeCode ?? 4002, "Invalid relay message");
      }
    });
    socket.on("close", () => {
      clearTimeout(helloTimeout);
      const connection = connections.get(socket);
      const session = connection?.session;
      if (!session) return;
      if (connection.role === "device" && session.device === socket) {
        session.device = null;
        for (const id of session.pendingSerialRequests) {
          send(session.operator, {
            type: "serial_result",
            id,
            ok: false,
            error: "The person's browser disconnected during the serial request.",
          });
        }
        session.pendingSerialRequests.clear();
        send(session.operator, {
          type: "peer",
          role: "device",
          online: false,
        });
      }
      if (connection.role === "operator" && session.operator === socket) {
        session.operator = null;
        send(session.device, {
          type: "peer",
          role: "operator",
          online: false,
        });
      }
    });
    socket.on("error", (error) => {
      logger.warn?.(`Remote-support WebSocket error: ${error.message}`);
    });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== path) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (webSocketServer.clients.size >= maxConnections) {
      socket.write(
        "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 30\r\n\r\n",
      );
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  const maintenance = setInterval(() => {
    expireSessions();
    for (const socket of webSocketServer.clients) {
      const connection = connections.get(socket);
      if (connection && !connection.alive) {
        socket.terminate();
        continue;
      }
      if (connection) connection.alive = false;
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  maintenance.unref();

  return {
    httpServer,
    webSocketServer,
    sessions,
    async listen() {
      await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          httpServer.off("error", reject);
          resolve();
        });
      });
      return httpServer.address();
    },
    async close() {
      clearInterval(maintenance);
      for (const socket of webSocketServer.clients) {
        socket.terminate();
      }
      await new Promise((resolve) => webSocketServer.close(resolve));
      if (httpServer.listening) {
        await new Promise((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  };
}

async function runFromEnvironment() {
  const operatorKey = process.env.SUPPORT_OPERATOR_KEY;
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "0.0.0.0";
  const path = process.env.REMOTE_SUPPORT_PATH ?? "/remote-support/ws";
  const server = createRemoteSupportServer({
    operatorKey,
    port,
    host,
    path,
  });
  const address = await server.listen();
  console.log(
    `SybilSight remote-support relay listening on ${address.address}:${address.port}${path}`,
  );
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runFromEnvironment().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
