import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createContext, runInContext } from "node:vm";
import { segmentsToSrt } from "./bilibili";
import {
  DOUYIN_BAD_LINK,
  DOUYIN_NOT_FOUND,
  DOUYIN_NO_MEDIA,
  DOUYIN_USER_AGENT,
  DouyinVideo,
  canonicalDouyinUrl,
  douyinDetailUrl,
  douyinMarkdown,
  parseDouyinId,
  segmentsFromCaption,
  videoFromDetail,
} from "./douyin";
import { normalizeVideoSettings, loadUserConfig, updatePendingTitle, writeSourceProgress, getLibraryPath } from "./storage";
import { transcribeAudio } from "./whisper";

const SESSION_MS = 10 * 60 * 1000;

let sessionCache: { at: number; cookie: string; uifid: string } | null = null;

function absorbCookies(jar: Map<string, string>, response: Response): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const header of list) {
    const pair = header.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function pageHeaders(cookie = ""): HeadersInit {
  return {
    "User-Agent": DOUYIN_USER_AGENT,
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: "https://www.douyin.com/",
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function scriptsFromHtml(html: string): string[] {
  const scripts: string[] = [];
  let from = 0;
  while (from < html.length) {
    const start = html.indexOf("<script", from);
    if (start < 0) break;
    const openEnd = html.indexOf(">", start);
    const close = html.indexOf("</script>", openEnd);
    if (openEnd < 0 || close < 0) break;
    scripts.push(html.slice(openEnd + 1, close));
    from = close + 9;
  }
  return scripts;
}

function acceptChallenge(jar: Map<string, string>, html: string): void {
  const document = {
    referrer: "",
    get cookie() { return cookieHeader(jar); },
    set cookie(value: string) {
      const pair = String(value).split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
    },
  };
  const sandbox = {
    console,
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    navigator: { userAgent: DOUYIN_USER_AGENT, language: "zh-CN", platform: "Win32" },
    location: { href: "https://www.douyin.com/", protocol: "https:", host: "www.douyin.com", reload() {} },
    history: {},
    Image: function Image() {},
    document,
    performance: { timing: { navigationStart: Date.now() } },
    localStorage: { setItem() {}, getItem() { return null; } },
    sessionStorage: { setItem() {}, getItem() { return null; } },
  };
  const context = sandbox as typeof sandbox & { window: typeof sandbox; global: typeof sandbox; self: typeof sandbox };
  context.window = context;
  context.global = context;
  context.self = context;
  createContext(context);
  for (const script of scriptsFromHtml(html)) {
    runInContext(script, context, { timeout: 8000 });
  }
}

async function openDouyinSession(force = false): Promise<{ cookie: string; uifid: string }> {
  if (!force && sessionCache && Date.now() - sessionCache.at < SESSION_MS) return sessionCache;
  const first = await fetch("https://www.douyin.com/", { headers: pageHeaders() });
  const html = await first.text();
  const jar = new Map<string, string>();
  absorbCookies(jar, first);
  if (html.includes("byted_acrawler")) {
    acceptChallenge(jar, html);
    if (!jar.has("__ac_signature")) throw new Error("Douyin did not open a public session.");
    const second = await fetch("https://www.douyin.com/", { headers: pageHeaders(cookieHeader(jar)) });
    absorbCookies(jar, second);
    await second.text();
  }
  const uifid = jar.get("UIFID_TEMP") || jar.get("UIFID") || "";
  if (!uifid) throw new Error("Douyin did not open a public session.");
  sessionCache = { at: Date.now(), cookie: cookieHeader(jar), uifid };
  return sessionCache;
}

async function resolveDouyinUrl(input: string): Promise<string> {
  const canonical = canonicalDouyinUrl(input);
  if (!canonical) throw new Error(DOUYIN_BAD_LINK);
  if (parseDouyinId(canonical)) return canonical;
  let current = canonical;
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(current, { headers: pageHeaders(), redirect: "manual" });
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) break;
    current = new URL(location, current).toString();
    const resolved = canonicalDouyinUrl(current);
    if (resolved && parseDouyinId(resolved)) return resolved;
  }
  throw new Error(DOUYIN_BAD_LINK);
}

async function fetchDetail(videoId: string, session: { cookie: string; uifid: string }): Promise<unknown> {
  const response = await fetch(douyinDetailUrl(videoId, session.uifid), {
    headers: {
      ...pageHeaders(session.cookie),
      Accept: "application/json, text/plain, */*",
      Referer: `https://www.douyin.com/video/${videoId}`,
    },
  });
  const text = await response.text();
  if (!response.ok || text.includes("ArgusSecurityPlugin")) {
    throw new Error("Douyin did not accept the request.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(DOUYIN_NOT_FOUND);
  }
}

async function loadVideo(videoId: string): Promise<{ video: DouyinVideo; cookie: string }> {
  let session = await openDouyinSession();
  try {
    const payload = await fetchDetail(videoId, session);
    const video = videoFromDetail(payload, videoId);
    if (!video) throw new Error(DOUYIN_NOT_FOUND);
    return { video, cookie: session.cookie };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("did not accept")) throw error;
    sessionCache = null;
    session = await openDouyinSession(true);
    const payload = await fetchDetail(videoId, session);
    const video = videoFromDetail(payload, videoId);
    if (!video) throw new Error(DOUYIN_NOT_FOUND);
    return { video, cookie: session.cookie };
  }
}

async function readCaptions(url: string, cookie: string): Promise<ReturnType<typeof segmentsFromCaption>> {
  const response = await fetch(url, { headers: pageHeaders(cookie) });
  if (!response.ok) return [];
  return segmentsFromCaption(await response.text());
}

async function downloadMedia(urls: string[], dest: string, cookie: string): Promise<void> {
  for (const url of urls) {
    const response = await fetch(url, { headers: pageHeaders(cookie) });
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1024 || bytes.subarray(0, 1).toString() === "<" || bytes.subarray(0, 1).toString() === "{") continue;
    await fs.writeFile(dest, bytes);
    return;
  }
  throw new Error(DOUYIN_NO_MEDIA);
}

async function transcribeMedia(id: string, video: DouyinVideo, cookie: string) {
  const dest = path.join(os.tmpdir(), `secondbrain-dy-${id}.mp4`);
  await downloadMedia(video.mediaUrls, dest, cookie);
  const settings = normalizeVideoSettings(await loadUserConfig());
  await writeSourceProgress(id, "Transcribing audio");
  try {
    return await transcribeAudio(dest, settings);
  } finally {
    if (settings.deleteAudioAfter) {
      await fs.unlink(dest).catch(() => undefined);
    } else {
      const saved = path.join(getLibraryPath(), id, "audio.mp4");
      await fs.rename(dest, saved).catch(async () => {
        await fs.copyFile(dest, saved).catch(() => undefined);
        await fs.unlink(dest).catch(() => undefined);
      });
    }
  }
}

export async function captureDouyinVideo(
  id: string,
  input: string
): Promise<{ title: string; markdown: string; srt: string; url: string }> {
  const url = await resolveDouyinUrl(input);
  const videoId = parseDouyinId(url);
  if (!videoId) throw new Error(DOUYIN_BAD_LINK);
  await writeSourceProgress(id, "Confirming the video");
  const loaded = await loadVideo(videoId);
  const video = loaded.video;
  await updatePendingTitle(id, video.title).catch(() => undefined);
  let segments = video.captionUrl ? await readCaptions(video.captionUrl, loaded.cookie) : [];
  if (segments.length === 0 && video.mediaUrls.length > 0) {
    await writeSourceProgress(id, "Downloading audio");
    try {
      segments = await transcribeMedia(id, video, loaded.cookie);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const descriptionOnly = video.title !== "抖音视频" && (
        message === DOUYIN_NO_MEDIA || message.includes("No transcript text")
      );
      if (!descriptionOnly) throw error;
      segments = [];
    }
  }
  const markdown = douyinMarkdown(video, segments);
  if (!markdown.trim()) throw new Error(DOUYIN_NO_MEDIA);
  return {
    title: video.title,
    markdown,
    srt: segmentsToSrt(segments),
    url,
  };
}
