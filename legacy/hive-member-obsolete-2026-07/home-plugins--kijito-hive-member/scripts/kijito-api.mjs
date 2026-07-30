import fs from "node:fs";
import https from "node:https";

const HOST = "api.kijito.ai";
const USER_AGENT = "kijito-codex-bridge/0.1.0";
const MAX_TOKEN_BYTES = 16 * 1024;

export function readToken(tokenFile) {
  let fd = null;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    fd = fs.openSync(tokenFile, flags);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw Object.assign(new Error("Kijito token file is not a regular file"), {
        code: "token_file_unsafe",
      });
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw Object.assign(new Error("Kijito token file owner mismatch"), {
        code: "token_file_owner_mismatch",
      });
    }
    if ((stat.mode & 0o077) !== 0) {
      throw Object.assign(new Error("Kijito token file permissions are too broad"), {
        code: "token_file_permissions_unsafe",
      });
    }
    if (stat.size > MAX_TOKEN_BYTES) {
      throw Object.assign(new Error("Kijito token file exceeds the size limit"), {
        code: "token_file_too_large",
      });
    }
    const token = fs.readFileSync(fd, "utf8").trim();
    if (token && /[\s\u0000-\u001f\u007f]/.test(token)) {
      throw Object.assign(new Error("Kijito token file content is invalid"), {
        code: "token_file_content_invalid",
      });
    }
    return token || null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ELOOP") {
      throw Object.assign(new Error("Kijito token file is not a regular file"), {
        code: "token_file_unsafe",
      });
    }
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

export function requestJson({
  requestPath,
  token,
  method = "GET",
  body = null,
  timeoutMs = 5000,
  responseLimitBytes = 1024 * 1024,
  requestImpl = https.request,
}) {
  const target = new URL(requestPath, `https://${HOST}`);
  if (target.protocol !== "https:"
    || target.hostname !== HOST
    || !target.pathname.startsWith("/api/")
    || /[\r\n\\]/.test(requestPath)) {
    throw new Error("Kijito API path must stay under /api/");
  }
  if (!token) throw new Error("Kijito API token is unavailable");
  if (!["GET", "POST"].includes(method)) {
    throw new Error(`unsupported Kijito API method: ${method}`);
  }
  const payload = body === null ? null : Buffer.from(JSON.stringify(body), "utf8");

  return new Promise((resolve, reject) => {
    const request = requestImpl({
      protocol: "https:",
      hostname: HOST,
      port: 443,
      method,
      path: `${target.pathname}${target.search}`,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(payload ? {
          "Content-Type": "application/json",
          "Content-Length": String(payload.length),
        } : {}),
      },
      timeout: timeoutMs,
    }, (response) => {
      const status = Number(response.statusCode || 0);
      response.on("error", reject);
      if (status >= 300 && status < 400) {
        response.resume();
        reject(Object.assign(new Error("Kijito API redirects are not followed"), {
          code: "kijito_redirect_refused",
        }));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > responseLimitBytes) {
          response.destroy(Object.assign(new Error("Kijito API response exceeded size limit"), {
            code: "kijito_response_too_large",
          }));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (size > responseLimitBytes) return;
        if (status < 200 || status >= 300) {
          reject(Object.assign(new Error(`Kijito API returned HTTP ${status}`), {
            code: `kijito_http_${status}`,
          }));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(Object.assign(new Error("Kijito API returned invalid JSON"), {
            code: "kijito_invalid_json",
          }));
        }
      });
    });
    request.on("timeout", () => {
      request.destroy(Object.assign(new Error("Kijito API request timed out"), {
        code: "kijito_timeout",
      }));
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function resultRows(data) {
  return Array.isArray(data?.result) ? data.result : [];
}

export async function fetchInbox({
  persona,
  tokenFile,
  timeoutMs = 5000,
  requestImpl,
}) {
  try {
    const token = readToken(tokenFile);
    if (!token) {
      return { available: false, messages: [], error: "token_file_missing" };
    }
    const query = new URLSearchParams({ persona, mark_read: "false" });
    const data = await requestJson({
      requestPath: `/api/inbox?${query}`,
      token,
      timeoutMs,
      requestImpl,
    });
    return { available: true, messages: resultRows(data), error: null };
  } catch (error) {
    return {
      available: false,
      messages: [],
      error: error.code || "kijito_inbox_failed",
    };
  }
}

export async function fetchUnreadCounts({
  tokenFile,
  timeoutMs = 5000,
  requestImpl,
}) {
  try {
    const token = readToken(tokenFile);
    if (!token) {
      return { available: false, counts: {}, error: "token_file_missing" };
    }
    const data = await requestJson({
      requestPath: "/api/notify/pending",
      token,
      timeoutMs,
      requestImpl,
    });
    const counts = {};
    for (const row of resultRows(data)) {
      if (!row || typeof row.persona !== "string") continue;
      counts[row.persona] = {
        unread: Number(row.unread || 0),
        unreadUrgent: Number(row.unread_urgent || 0),
      };
    }
    return { available: true, counts, error: null };
  } catch (error) {
    return {
      available: false,
      counts: {},
      error: error.code || "kijito_pending_failed",
    };
  }
}

export async function sendMessage({
  to,
  from,
  content,
  urgent = false,
  tokenFile,
  timeoutMs = 10000,
  responseLimitBytes = 1024 * 1024,
  maxContentBytes = 4096,
  requestImpl,
}) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(String(to || ""))
    || !/^[a-z][a-z0-9_-]{0,63}$/.test(String(from || ""))) {
    throw Object.assign(new Error("Kijito send persona is invalid"), {
      code: "outbound_persona_invalid",
    });
  }
  const contentBytes = Buffer.byteLength(String(content || ""), "utf8");
  if (typeof content !== "string"
    || contentBytes < 1
    || contentBytes > maxContentBytes
    || /[\u0000\u0008\u000B\u000C]/.test(content)) {
    throw Object.assign(new Error("Kijito send content is invalid"), {
      code: "outbound_content_invalid",
    });
  }
  const token = readToken(tokenFile);
  if (!token) {
    throw Object.assign(new Error("Kijito API token is unavailable"), {
      code: "token_file_missing",
    });
  }
  const data = await requestJson({
    requestPath: "/api/send",
    token,
    method: "POST",
    body: { to, from, content, urgent: Boolean(urgent) },
    timeoutMs,
    responseLimitBytes,
    requestImpl,
  });
  const result = data?.result;
  if (!result || !Number.isSafeInteger(Number(result.id)) || Number(result.id) <= 0) {
    throw Object.assign(new Error("Kijito send response is invalid"), {
      code: "kijito_invalid_send_response",
    });
  }
  if (String(result.to || to) !== String(to)) {
    throw Object.assign(new Error("Kijito send response recipient mismatch"), {
      code: "kijito_send_recipient_mismatch",
    });
  }
  return {
    id: Number(result.id),
    to: String(result.to || to),
  };
}
