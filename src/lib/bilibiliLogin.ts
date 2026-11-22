import { promises as fs } from "fs";
import path from "path";
import { BILIBILI_USER_AGENT } from "./bilibili";
import { getBilibiliCookiePath } from "./storage";

export type QrLoginState = "waiting" | "scanned" | "confirmed" | "expired";

const SESSION_COOKIE_NAMES = ["SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5", "sid"];

const passportHeaders = {
  "User-Agent": BILIBILI_USER_AGENT,
  Referer: "https://passport.bilibili.com/",
};

export function isQrcodeKey(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}

export function qrLoginState(code: unknown): QrLoginState | null {
  const value = Number(code);
  if (value === 0) return "confirmed";
  if (value === 86090) return "scanned";
  if (value === 86101) return "waiting";
  if (value === 86038) return "expired";
  return null;
}

export function mergeCookieHeaders(...headers: string[]): string {
  const pairs = new Map<string, string>();
  for (const header of headers) {
    for (const part of header.split(";")) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      pairs.set(trimmed.slice(0, eq), trimmed);
    }
  }
  return [...pairs.values()].join("; ");
}

export function cookieHeaderFromSetCookie(setCookies: string[]): string {
  const pairs: string[] = [];
  for (const header of setCookies) {
    const pair = header.split(";")[0]?.trim() ?? "";
    if (pair.includes("=") && !pair.startsWith("=")) pairs.push(pair);
  }
  return mergeCookieHeaders(pairs.join("; "));
}

export function cookieFromLoginUrl(url: string): string {
  const query = url.split("?")[1]?.split("#")[0] ?? "";
  if (!query) return "";
  const wanted = new Set(SESSION_COOKIE_NAMES);
  const parts: string[] = [];
  for (const pair of query.split("&")) {
    const name = pair.slice(0, pair.indexOf("="));
    if (wanted.has(name) && pair.length > name.length + 1) parts.push(pair);
  }
  return parts.join("; ");
}

export function cleanBilibiliCookie(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cookie = value.replace(/[\r\n]/g, "").trim();
  if (!cookie || cookie.length > 8192 || !cookie.includes("=")) return null;
  return cookie;
}

export async function writeBilibiliCookie(cookie: string): Promise<void> {
  const cookiePath = getBilibiliCookiePath();
  await fs.mkdir(path.dirname(cookiePath), { recursive: true });
  await fs.writeFile(cookiePath, `${cookie}\n`, { encoding: "utf-8", mode: 0o600 });
}

function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function bilibiliHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "bilibili.com" || host.endsWith(".bilibili.com");
  } catch {
    return false;
  }
}

export async function startQrLogin(fetchImpl: typeof fetch = fetch): Promise<{ qrcodeKey: string; url: string }> {
  const response = await fetchImpl("https://passport.bilibili.com/x/passport-login/web/qrcode/generate", {
    headers: passportHeaders,
  });
  const payload = await response.json() as { code?: number; data?: { url?: string; qrcode_key?: string } };
  const qrcodeKey = payload.data?.qrcode_key || "";
  const url = payload.data?.url || "";
  if (payload.code !== 0 || !isQrcodeKey(qrcodeKey) || !bilibiliHost(url)) {
    throw new Error("Bilibili did not return a login QR code.");
  }
  return { qrcodeKey, url };
}

async function followForCookies(url: string, cookie: string, fetchImpl: typeof fetch): Promise<string> {
  let current = url;
  const collected: string[] = [];
  for (let hop = 0; hop < 4; hop += 1) {
    if (!bilibiliHost(current)) break;
    const response = await fetchImpl(current, {
      headers: { ...passportHeaders, Cookie: cookie },
      redirect: "manual",
    });
    collected.push(cookieHeaderFromSetCookie(setCookieHeaders(response)));
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) break;
    current = new URL(location, current).toString();
  }
  return mergeCookieHeaders(...collected);
}

export async function pollQrLogin(
  qrcodeKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ state: QrLoginState; cookie: string | null }> {
  const response = await fetchImpl(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`,
    { headers: passportHeaders, redirect: "manual" }
  );
  const payload = await response.json() as { data?: { code?: unknown; url?: unknown } };
  const state = qrLoginState(payload.data?.code);
  if (state !== "confirmed") return { state: state ?? "expired", cookie: null };

  const fromHeaders = cookieHeaderFromSetCookie(setCookieHeaders(response));
  const confirmUrl = typeof payload.data?.url === "string" ? payload.data.url : "";
  const fromUrl = cookieFromLoginUrl(confirmUrl);
  let followed = "";
  const seed = mergeCookieHeaders(fromUrl, fromHeaders);
  if (confirmUrl && bilibiliHost(confirmUrl) && seed.includes("SESSDATA=")) {
    try {
      followed = await followForCookies(confirmUrl, seed, fetchImpl);
    } catch {
      followed = "";
    }
  }
  const cookie = mergeCookieHeaders(seed, followed);
  if (!cookie.includes("SESSDATA=")) {
    throw new Error("Bilibili confirmed the scan, but did not return a session.");
  }
  return { state: "confirmed", cookie };
}
