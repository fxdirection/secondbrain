import { randomBytes } from "crypto";
import { writeZhihuCookie } from "./zhihuCapture";

const ZHIHU_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const SESSION_MS = 3 * 60 * 1000;

interface QrSession {
  jar: Map<string, string>;
  token: string;
  createdAt: number;
}

const sessions = new Map<string, QrSession>();

export type ZhihuQrState = "waiting" | "scanned" | "confirmed" | "expired" | "blocked";

export function isZhihuLoginId(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}

function absorb(jar: Map<string, string>, response: Response): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const header of list) {
    const pair = header.split(";")[0]?.trim() ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function xsrf(jar: Map<string, string>): string {
  const raw = jar.get("_xsrf") || "";
  try {
    return decodeURIComponent(raw).replace(/^"|"$/g, "");
  } catch {
    return raw.replace(/^"|"$/g, "");
  }
}

function applyCookieText(jar: Map<string, string>, value: string): void {
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0) jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
}

async function zhihuCall(jar: Map<string, string>, method: string, url: string, referer: string): Promise<Response> {
  const response = await fetch(url, {
    method,
    headers: {
      "User-Agent": ZHIHU_USER_AGENT,
      Referer: referer,
      Accept: "application/json, text/html, */*",
      ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}),
      ...(method === "POST"
        ? { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "0", "x-xsrftoken": xsrf(jar) }
        : {}),
    },
    body: method === "POST" ? "" : undefined,
    redirect: "manual",
  });
  absorb(jar, response);
  return response;
}

function dropExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_MS) sessions.delete(id);
  }
}

export function zhihuScanState(payload: { status?: unknown; error?: { code?: unknown } }): ZhihuQrState | null {
  if (payload.error?.code === 40352) return "blocked";
  const status = payload.status;
  if (status === 0 || status === "waiting") return "waiting";
  if (status === 1 || status === "scanned") return "scanned";
  if (status === 2 || status === "confirmed") return "confirmed";
  if (status === 3 || status === "expired") return "expired";
  return null;
}

export function zhihuVerifyUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value, "https://www.zhihu.com");
    if (url.protocol !== "https:" || (url.hostname !== "www.zhihu.com" && url.hostname !== "zhihu.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function startZhihuQrLogin(): Promise<{ loginId: string; url: string }> {
  dropExpired();
  const jar = new Map<string, string>();
  const signin = await zhihuCall(jar, "GET", "https://www.zhihu.com/signin", "https://www.zhihu.com/");
  if (!signin.ok && signin.status !== 302) throw new Error("Zhihu did not open a login session.");
  await signin.text();
  const udid = await zhihuCall(jar, "POST", "https://www.zhihu.com/udid", "https://www.zhihu.com/signin");
  await udid.text();
  if (!jar.has("d_c0")) throw new Error("Zhihu did not return a device id.");
  const created = await zhihuCall(jar, "POST", "https://www.zhihu.com/api/v3/account/api/login/qrcode", "https://www.zhihu.com/signin");
  const payload = await created.json() as { token?: string; link?: string };
  if (!created.ok || !payload.token) throw new Error("Zhihu did not return a login QR code.");
  const loginId = randomBytes(16).toString("hex");
  sessions.set(loginId, { jar, token: payload.token, createdAt: Date.now() });
  return {
    loginId,
    url: payload.link || `https://www.zhihu.com/account/scan/login/${payload.token}`,
  };
}

export async function pollZhihuQrLogin(loginId: string): Promise<{ state: ZhihuQrState; verifyUrl: string | null; cookie: string | null }> {
  const session = sessions.get(loginId);
  if (!session || Date.now() - session.createdAt > SESSION_MS) {
    sessions.delete(loginId);
    return { state: "expired", verifyUrl: null, cookie: null };
  }
  const response = await zhihuCall(
    session.jar,
    "GET",
    `https://www.zhihu.com/api/v3/account/api/login/qrcode/${encodeURIComponent(session.token)}/scan_info`,
    "https://www.zhihu.com/signin"
  );
  const text = await response.text();
  let payload: { status?: unknown; cookie?: unknown; error?: { code?: unknown; redirect?: unknown } } = {};
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    payload = {};
  }
  if (typeof payload.cookie === "string") applyCookieText(session.jar, payload.cookie);
  if (session.jar.has("z_c0")) {
    const cookie = cookieHeader(session.jar);
    sessions.delete(loginId);
    await writeZhihuCookie(cookie);
    return { state: "confirmed", verifyUrl: null, cookie };
  }
  const state = zhihuScanState(payload);
  if (state === "blocked" || response.status === 403) {
    return { state: "blocked", verifyUrl: zhihuVerifyUrl(payload.error?.redirect), cookie: null };
  }
  if (state === "expired") sessions.delete(loginId);
  return { state: state ?? "waiting", verifyUrl: null, cookie: null };
}
