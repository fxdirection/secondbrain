import { promises as fs } from "fs";
import path from "path";
import {
  XHS_LOGIN_REJECTED,
  XHS_LOGIN_REQUIRED,
  noteFromHtml,
  parseXiaohongshuUrl,
  xiaohongshuMarkdown,
  xhsLoggedInName,
} from "./xiaohongshu";
import { getXiaohongshuCookiePath, updatePendingTitle } from "./storage";

const XHS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function readCookie(): Promise<string | null> {
  try {
    const text = (await fs.readFile(getXiaohongshuCookiePath(), "utf-8")).trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function writeXiaohongshuCookie(cookie: string): Promise<void> {
  const cookiePath = getXiaohongshuCookiePath();
  await fs.mkdir(path.dirname(cookiePath), { recursive: true });
  await fs.writeFile(cookiePath, `${cookie}\n`, { encoding: "utf-8", mode: 0o600 });
}

function pageHeaders(cookie: string | null): HeadersInit {
  return {
    "User-Agent": XHS_USER_AGENT,
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: "https://www.xiaohongshu.com/",
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

async function resolveNoteUrl(input: string): Promise<string> {
  let current = input.trim();
  for (let hop = 0; hop < 5; hop += 1) {
    if (parseXiaohongshuUrl(current)) return current;
    const response = await fetch(current, { headers: pageHeaders(null), redirect: "manual" });
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) break;
    current = new URL(location, current).toString();
  }
  return current;
}

async function fetchHtml(url: string, cookie: string | null): Promise<{ html: string; finalUrl: string }> {
  const response = await fetch(url, {
    headers: pageHeaders(cookie),
    redirect: "follow",
  });
  return { html: await response.text(), finalUrl: response.url };
}

export async function captureXiaohongshuNote(
  id: string,
  input: string
): Promise<{ title: string; markdown: string; url: string }> {
  const cookie = await readCookie();
  const resolvedUrl = await resolveNoteUrl(input);
  const parsed = parseXiaohongshuUrl(resolvedUrl);
  let note = null;
  if (cookie && parsed) {
    try {
      const { fetchXiaohongshuFeed } = await import("./xiaohongshuLogin");
      const fed = await fetchXiaohongshuFeed(cookie, parsed.id, parsed.token, parsed.source);
      if (fed === "rejected") throw new Error(XHS_LOGIN_REJECTED);
      note = fed;
    } catch (error) {
      if (error instanceof Error && error.message === XHS_LOGIN_REJECTED) throw error;
      note = null;
    }
  }
  let pageUrl = resolvedUrl;
  if (!note) {
    const first = await fetchHtml(resolvedUrl, cookie);
    pageUrl = first.finalUrl || resolvedUrl;
    note = noteFromHtml(first.html, parseXiaohongshuUrl(pageUrl)?.id || parsed?.id || "");
  }
  if (!note) throw new Error(cookie ? XHS_LOGIN_REJECTED : XHS_LOGIN_REQUIRED);
  const title = note.title || note.desc.slice(0, 40) || "小红书笔记";
  await updatePendingTitle(id, title).catch(() => undefined);
  return {
    title,
    markdown: xiaohongshuMarkdown(note),
    url: pageUrl,
  };
}

export async function xiaohongshuLoginName(cookie: string): Promise<string | null> {
  const { html } = await fetchHtml("https://www.xiaohongshu.com/explore", cookie);
  return xhsLoggedInName(html);
}
