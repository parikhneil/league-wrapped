import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { createGuide, isInjection, validateChatBody } from "../../server.mjs";

export const config = { path: ["/api/chat", "/api/chat/session"] };
const COOKIE = "league_chat";
const STATE_KEY = "bounded-state-v1";
const SESSION_TTL = 30 * 60 * 1000;
const REFUSAL =
  "I can help with this league, the dashboard, and fantasy football statistics. Ask about a manager, matchup, metric, draft, or transaction.";

function response(status, body, extra = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      ...extra,
    },
  });
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function sameToken(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sessionId(request) {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE}=`));
  if (matches.length !== 1) return null;
  const id = matches[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{48}$/.test(id) ? id : null;
}

function freshState() {
  return {
    sessions: {},
    handshakes: {},
    ips: {},
    sessionLimits: {},
    global: {},
    leases: {},
  };
}

function prune(state, timestamp) {
  for (const key of ["handshakes", "ips", "sessionLimits", "global"]) {
    for (const [id, value] of Object.entries(state[key]))
      if (value.until <= timestamp) delete state[key][id];
  }
  for (const [id, value] of Object.entries(state.leases))
    if (value.until <= timestamp) delete state.leases[id];
  for (const [id, value] of Object.entries(state.sessions)) {
    if (value.expires <= timestamp) delete state.sessions[id];
    else if (value.busy && !state.leases[value.busy]) value.busy = null;
  }
}

function take(buckets, key, count, duration, timestamp, cap = 3000) {
  let bucket = buckets[key];
  if (!bucket) {
    if (Object.keys(buckets).length >= cap) return false;
    bucket = buckets[key] = { count: 0, until: timestamp + duration };
  }
  if (bucket.count >= count) return false;
  bucket.count += 1;
  return true;
}

async function update(store, operation, timestamp) {
  // A short compare-and-swap transaction protects quotas and session admission across
  // separate function instances. Never hold a storage lock while waiting for Groq.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await store.getWithMetadata(STATE_KEY, {
      type: "json",
      consistency: "strong",
    });
    const state = current?.data ?? freshState();
    prune(state, timestamp);
    const result = operation(state);
    const write = await store.setJSON(
      STATE_KEY,
      state,
      current ? { onlyIfMatch: current.etag } : { onlyIfNew: true },
    );
    if (write.modified) return result;
  }
  throw new Error("Storage contention");
}

async function readBody(request) {
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    return { error: response(415, { error: "Send a UTF-8 JSON request." }) };
  if (
    request.headers.get("content-encoding") &&
    request.headers.get("content-encoding") !== "identity"
  )
    return {
      error: response(415, { error: "Compressed requests are not supported." }),
    };
  if (Number(request.headers.get("content-length")) > 4096)
    return { error: response(413, { error: "That request is too large." }) };
  const reader = request.body?.getReader();
  if (!reader)
    return { error: response(400, { error: "Send a valid JSON request." }) };
  let total = 0;
  const chunks = [];
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reader.cancel().catch(() => {});
      reject(new Error("Body timeout"));
    }, 5000);
  });
  try {
    const read = (async () => {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.length;
        if (total > 4096) {
          await reader.cancel();
          return {
            error: response(413, { error: "That request is too large." }),
          };
        }
        chunks.push(part.value);
      }
      const body = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
      const input = validateChatBody(body);
      return input
        ? { input }
        : {
            error: response(400, {
              error:
                "Use a question of 1–1,500 characters and valid dashboard filters.",
            }),
          };
    })();
    return await Promise.race([read, timeout]);
  } catch {
    return { error: response(400, { error: "Send a valid JSON request." }) };
  } finally {
    clearTimeout(timer);
  }
}

export function createNetlifyHandler({
  env = process.env,
  storeFactory,
  fetchImpl,
  buildContext,
  now = Date.now,
} = {}) {
  const originCandidates = [
    ...(env.CHAT_ALLOWED_ORIGINS ?? "").split(","),
    env.URL,
    env.DEPLOY_PRIME_URL,
  ]
    .filter(Boolean)
    .map((value) => value.trim());
  if (env.NETLIFY_DEV === "true")
    originCandidates.push("http://localhost:8888", "http://127.0.0.1:8888");
  const origins = new Set();
  for (const candidate of originCandidates) {
    try {
      const parsed = new URL(candidate);
      if (
        /^https?:$/.test(parsed.protocol) &&
        parsed.origin === candidate &&
        !parsed.username &&
        !parsed.password
      )
        origins.add(candidate);
    } catch {
      /* Invalid configuration stays closed. */
    }
  }
  const hosts = new Set([...origins].map((origin) => new URL(origin).host));
  const model = env.GROQ_MODEL ?? "openai/gpt-oss-120b";
  const key = env.GROQ_API_KEY ?? "";
  const answerQuestion = createGuide({
    apiKey: key,
    model,
    fetchImpl,
    buildContext,
  });
  const limits = {
    perMinute: number(env.CHAT_REQUESTS_PER_MINUTE, 8, 1, 120),
    globalMinute: number(env.CHAT_GLOBAL_PER_MINUTE, 40, 1, 1000),
    globalDay: number(env.CHAT_GLOBAL_PER_DAY, 200, 1, 10000),
    concurrency: number(env.CHAT_CONCURRENCY, 2, 1, 10),
  };
  return async function handler(request, netlifyContext) {
    const url = new URL(request.url);
    if (
      !hosts.has(url.host) ||
      (request.headers.get("host") && !hosts.has(request.headers.get("host")))
    )
      return response(403, { error: "This host is not allowed." });
    const origin = request.headers.get("origin");
    if (
      (origin && !origins.has(origin)) ||
      ["cross-site", "same-site"].includes(
        request.headers.get("sec-fetch-site"),
      ) ||
      (request.method === "POST" && !origin)
    )
      return response(403, { error: "Open chat from this website." });
    if (!["/api/chat", "/api/chat/session"].includes(url.pathname))
      return response(404, { error: "Not found." });
    if (
      !(
        request.method === "POST" ||
        (url.pathname === "/api/chat/session" && request.method === "GET")
      )
    )
      return response(
        405,
        { error: "This method is not supported." },
        { Allow: url.pathname === "/api/chat/session" ? "GET, POST" : "POST" },
      );
    // The platform's verified client IP is authoritative. Never trust caller-supplied forwarded headers.
    const ip = netlifyContext?.ip;
    if (typeof ip !== "string" || !ip || ip.length > 100)
      return response(503, {
        error: "Chat is unavailable just now. Try again shortly.",
      });
    const ipId = crypto.createHash("sha256").update(ip).digest("hex");
    let store;
    try {
      store = storeFactory
        ? storeFactory()
        : getStore({ name: "league-chat-private-v1", consistency: "strong" });
    } catch {
      return response(503, {
        error: "Chat storage is unavailable just now. Try again shortly.",
      });
    }
    const id = sessionId(request);
    const timestamp = now();
    const sessionResponse = (session) => ({
      csrfToken: session.csrf,
      configured: Boolean(key),
      model,
    });
    try {
      if (request.method === "GET") {
        const admitted = await update(
          store,
          (state) => {
            if (!take(state.handshakes, ipId, 40, 60000, timestamp))
              return {
                status: 429,
                body: {
                  error: "Too many chat session requests. Try again shortly.",
                },
              };
            if (id && state.sessions[id])
              return { status: 200, body: sessionResponse(state.sessions[id]) };
            if (Object.keys(state.sessions).length >= 200)
              return {
                status: 503,
                body: { error: "Chat is busy. Try again shortly." },
              };
            const newId = crypto.randomBytes(24).toString("hex");
            const session = {
              csrf: crypto.randomBytes(24).toString("hex"),
              expires: timestamp + SESSION_TTL,
              history: [],
              busy: null,
            };
            state.sessions[newId] = session;
            return { status: 200, body: sessionResponse(session), newId };
          },
          timestamp,
        );
        return response(
          admitted.status,
          admitted.body,
          admitted.newId
            ? {
                "Set-Cookie": `${COOKIE}=${admitted.newId}; Path=/api/chat; HttpOnly; SameSite=Strict; Max-Age=1800${url.protocol === "https:" ? "; Secure" : ""}`,
              }
            : {},
        );
      }
      if (url.pathname === "/api/chat/session") {
        const reset = await update(
          store,
          (state) => {
            const session = id && state.sessions[id];
            if (
              !session ||
              !sameToken(request.headers.get("x-chat-csrf"), session.csrf)
            )
              return {
                status: 403,
                body: {
                  error:
                    "Your chat session expired. Reopen chat and try again.",
                },
              };
            if (session.busy)
              return {
                status: 409,
                body: {
                  error:
                    "Wait for the current answer before starting a new chat.",
                },
              };
            session.history = [];
            session.csrf = crypto.randomBytes(24).toString("hex");
            return { status: 200, body: sessionResponse(session) };
          },
          timestamp,
        );
        return response(reset.status, reset.body);
      }
      const parsed = await readBody(request);
      if (parsed.error) return parsed.error;
      const admitted = await update(
        store,
        (state) => {
          const session = id && state.sessions[id];
          if (
            !session ||
            !sameToken(request.headers.get("x-chat-csrf"), session.csrf)
          )
            return {
              status: 403,
              body: {
                error: "Your chat session expired. Reopen chat and try again.",
              },
            };
          if (
            session.busy ||
            Object.keys(state.leases).length >= limits.concurrency
          )
            return {
              status: 429,
              body: { error: "Chat is busy. Try again in a moment." },
            };
          if (
            !take(state.ips, ipId, limits.perMinute, 60000, timestamp) ||
            !take(
              state.sessionLimits,
              id,
              limits.perMinute,
              60000,
              timestamp,
            ) ||
            !take(
              state.global,
              "minute",
              limits.globalMinute,
              60000,
              timestamp,
            ) ||
            !take(state.global, "day", limits.globalDay, 86400000, timestamp)
          )
            return {
              status: 429,
              body: {
                error:
                  "The chat request limit has been reached. Try again later.",
              },
            };
          if (isInjection(parsed.input.message))
            return {
              status: 200,
              body: { answer: REFUSAL, sources: [], refused: true },
            };
          if (!key)
            return {
              status: 503,
              body: {
                error:
                  "Chat is not configured. The site owner needs to set GROQ_API_KEY on the server.",
              },
            };
          const lease = crypto.randomBytes(16).toString("hex");
          state.leases[lease] = { until: timestamp + 60000 };
          session.busy = lease;
          return { lease, history: session.history.slice(-4) };
        },
        timestamp,
      );
      if (!admitted.lease)
        return response(
          admitted.status,
          admitted.body,
          admitted.status === 429 ? { "Retry-After": "60" } : {},
        );
      let result;
      let status = 200;
      try {
        result = await answerQuestion(
          parsed.input,
          admitted.history,
          request.signal,
        );
      } catch {
        status = 502;
        result = {
          error:
            "The assistant could not answer just now. Please try again shortly.",
        };
      }
      // Persist history before returning success. If storage fails, the lease expires
      // after a minute and the next request cannot accidentally fork conversation state.
      await update(
        store,
        (state) => {
          const session = id && state.sessions[id];
          delete state.leases[admitted.lease];
          if (session?.busy === admitted.lease) {
            session.busy = null;
            if (status === 200 && !result.refused)
              session.history = [
                ...session.history,
                { question: parsed.input.message, answer: result.answer },
              ].slice(-4);
          }
          return null;
        },
        now(),
      );
      return response(status, result);
    } catch {
      return response(503, {
        error: "Chat storage is unavailable just now. Try again shortly.",
      });
    }
  };
}

export default async function handler(request, context) {
  // Each invocation can start on a fresh machine: all conversation state, rate
  // counters, and concurrency leases live in the persistent private Blobs store.
  return createNetlifyHandler()(request, context);
}
