import { spawn } from "child_process";
import path from "path";
import { randomBytes } from "crypto";
import { writeXiaohongshuCookie, xiaohongshuLoginName } from "./xiaohongshuCapture";
import {
  XhsQrState,
  cookieFromXhsConfirm,
  nicknameFromSelfinfo,
  noteFromFeed,
  xhsLoginUrl,
  xhsQrState,
} from "./xiaohongshu";

const XHS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const SESSION_MS = 4 * 60 * 1000;
const HOST = "https://edith.xiaohongshu.com";

interface QrSession {
  cookies: Map<string, string>;
  qrId: string;
  code: string;
  createdAt: number;
}

const sessions = new Map<string, QrSession>();

export function isXhsLoginId(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}

function scriptPath(): string {
  return path.join(process.cwd(), "src", "lib", "xhs_sign.py");
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function absorbSetCookie(cookies: Map<string, string>, response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : []);
  for (const header of list) {
    const pair = header.split(";")[0]?.trim() ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return list;
}

function runSigner(input: unknown): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [scriptPath()], { windowsHide: true });
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Xiaohongshu login timed out."));
    }, 20_000);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error("Xiaohongshu login could not be signed."));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string") headers[key] = value;
        }
        resolve(headers);
      } catch {
        reject(new Error("Xiaohongshu login could not be signed."));
      }
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

async function signedRequest(
  method: "GET" | "POST",
  uri: string,
  cookies: Map<string, string>,
  data: Record<string, unknown>
): Promise<Response> {
  const cookieObject = Object.fromEntries(cookies);
  const headers = await runSigner({
    action: method,
    uri: `${HOST}${uri}`,
    cookies: cookieObject,
    ...(method === "POST" ? { payload: data } : { params: data }),
  });
  const url = new URL(`${HOST}${uri}`);
  if (method === "GET") {
    for (const [key, value] of Object.entries(data)) url.searchParams.set(key, String(value));
  }
  return fetch(url, {
    method,
    headers: {
      ...headers,
      "User-Agent": XHS_USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Origin: "https://www.xiaohongshu.com",
      Referer: "https://www.xiaohongshu.com/",
      Cookie: cookieHeader(cookies),
      ...(method === "POST" ? { "Content-Type": "application/json;charset=UTF-8" } : {}),
    },
    body: method === "POST" ? JSON.stringify(data) : undefined,
    redirect: "manual",
  });
}

function dropExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_MS) sessions.delete(id);
  }
}

export async function startXhsQrLogin(): Promise<{ loginId: string; url: string }> {
  dropExpired();
  const device = await runSigner({ action: "device" });
  if (!/^[A-Za-z0-9]{20,80}$/.test(device.a1 || "") || !/^[a-f0-9]{32}$/.test(device.webId || "")) {
    throw new Error("Xiaohongshu did not return a device id.");
  }
  const cookies = new Map<string, string>([["a1", device.a1], ["webId", device.webId]]);
  const response = await signedRequest("POST", "/api/sns/web/v1/login/qrcode/create", cookies, { qr_type: 1 });
  const payload = await response.json() as { success?: boolean; data?: { url?: unknown; qr_id?: unknown; code?: unknown } };
  const url = xhsLoginUrl(payload.data?.url);
  const qrId = typeof payload.data?.qr_id === "string" || typeof payload.data?.qr_id === "number"
    ? String(payload.data.qr_id) : "";
  const code = typeof payload.data?.code === "string" || typeof payload.data?.code === "number"
    ? String(payload.data.code) : "";
  if (!response.ok || payload.success !== true || !url || !/^[0-9]{6,32}$/.test(qrId) || !/^[0-9]{4,12}$/.test(code)) {
    throw new Error("Xiaohongshu did not return a login QR code.");
  }
  absorbSetCookie(cookies, response);
  const loginId = randomBytes(16).toString("hex");
  sessions.set(loginId, { cookies, qrId, code, createdAt: Date.now() });
  return { loginId, url };
}

export async function pollXhsQrLogin(loginId: string): Promise<{ state: XhsQrState; cookie: string | null }> {
  const session = sessions.get(loginId);
  if (!session || Date.now() - session.createdAt > SESSION_MS) {
    sessions.delete(loginId);
    return { state: "expired", cookie: null };
  }
  const response = await signedRequest("GET", "/api/sns/web/v1/login/qrcode/status", session.cookies, {
    qr_id: session.qrId,
    code: session.code,
  });
  const payload = await response.json() as { success?: boolean; data?: { code_status?: unknown; login_info?: unknown } };
  const setCookies = absorbSetCookie(session.cookies, response);
  const state = xhsQrState(payload.data?.code_status);
  if (!response.ok || payload.success !== true || !state) {
    throw new Error("Could not check the Xiaohongshu login.");
  }
  if (state !== "confirmed") {
    if (state === "expired") sessions.delete(loginId);
    return { state, cookie: null };
  }
  const cookie = cookieFromXhsConfirm(cookieHeader(session.cookies), setCookies, payload.data?.login_info);
  sessions.delete(loginId);
  if (!cookie) throw new Error("Xiaohongshu confirmed the scan, but did not return a session.");
  await writeXiaohongshuCookie(cookie);
  return { state: "confirmed", cookie };
}

export async function xiaohongshuAccountName(cookie: string): Promise<string | null> {
  const cookies = new Map<string, string>();
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0) cookies.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  if (cookies.has("a1") && cookies.has("web_session")) {
    try {
      const response = await signedRequest("GET", "/api/sns/web/v1/user/selfinfo", cookies, {});
      const nickname = nicknameFromSelfinfo(await response.json());
      if (nickname) return nickname;
    } catch {
      // The page state below is the fallback for a pasted cookie.
    }
  }
  return xiaohongshuLoginName(cookie);
}

export async function fetchXiaohongshuFeed(
  cookie: string,
  noteId: string,
  token: string,
  source: string
): Promise<"rejected" | ReturnType<typeof noteFromFeed>> {
  const cookies = new Map<string, string>();
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0) cookies.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  if (!cookies.has("a1") || !cookies.has("web_session")) return "rejected";
  const response = await signedRequest("POST", "/api/sns/web/v1/feed", cookies, {
    source_note_id: noteId,
    image_formats: ["jpg", "webp", "avif"],
    extra: { need_body_topic: "1" },
    xsec_source: source || "pc_share",
    xsec_token: token,
  });
  const payload = await response.json() as { code?: unknown };
  if (payload.code === -101 || payload.code === "-101") return "rejected";
  return noteFromFeed(payload, noteId);
}
