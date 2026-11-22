export const XHS_LOGIN_REQUIRED =
  "This Xiaohongshu note is only visible after login. Paste a Cookie header in Settings → Accounts, then capture it again.";

export const XHS_LOGIN_REJECTED =
  "Xiaohongshu did not accept the saved Cookie. Paste a new Cookie header from a signed-in page.";

export interface XiaohongshuNote {
  id: string;
  title: string;
  desc: string;
  author: string;
  tags: string[];
  imageCount: number;
  video: boolean;
  token: string;
  source: string;
}

export function parseXiaohongshuUrl(input: string): { id: string; token: string; source: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "xiaohongshu.com") return null;
  const match = url.pathname.match(/\/(?:explore|discovery\/item|note)\/([0-9a-zA-Z]+)/);
  if (!match) return null;
  return {
    id: match[1],
    token: url.searchParams.get("xsec_token") || "",
    source: url.searchParams.get("xsec_source") || "",
  };
}

export function isXiaohongshuShortLink(input: string): boolean {
  try {
    const host = new URL(input.trim()).hostname.toLowerCase().replace(/^www\./, "");
    return host === "xhslink.com";
  } catch {
    return false;
  }
}

export function isXiaohongshuInput(input: string): boolean {
  return parseXiaohongshuUrl(input) !== null || isXiaohongshuShortLink(input);
}

export function canonicalXiaohongshuUrl(input: string): string | null {
  if (isXiaohongshuShortLink(input)) return input.trim();
  const parsed = parseXiaohongshuUrl(input);
  if (!parsed) return null;
  const url = new URL(`https://www.xiaohongshu.com/explore/${parsed.id}`);
  if (parsed.token) url.searchParams.set("xsec_token", parsed.token);
  if (parsed.source) url.searchParams.set("xsec_source", parsed.source);
  return url.toString();
}

export function initialStateFromHtml(html: string): Record<string, unknown> | null {
  const marker = html.search(/window\.__INITIAL_STATE__\s*=/);
  if (marker < 0) return null;
  const jsonStart = html.indexOf("{", marker);
  if (jsonStart < 0) return null;
  let depth = 0;
  let end = jsonStart;
  for (; end < html.length; end += 1) {
    if (html[end] === "{") depth += 1;
    else if (html[end] === "}") {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }
  try {
    return JSON.parse(html.slice(jsonStart, end).replace(/\bundefined\b/g, "null")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function noteFromHtml(html: string, noteId = ""): XiaohongshuNote | null {
  const state = initialStateFromHtml(html);
  const map = (state?.note as { noteDetailMap?: Record<string, { note?: Record<string, unknown> }> } | undefined)?.noteDetailMap;
  if (!map) return null;
  const entry = (noteId && map[noteId]) || Object.values(map)[0];
  const note = entry?.note;
  if (!note) return null;
  const title = stringField(note.title || note.displayTitle);
  const desc = stringField(note.desc);
  if (!title && !desc) return null;
  const user = note.user as { nickname?: string; nickName?: string } | undefined;
  const tags = Array.isArray(note.tagList)
    ? note.tagList.map((tag) => stringField((tag as { name?: string }).name)).filter(Boolean)
    : [];
  const images = Array.isArray(note.imageList) ? note.imageList.length : 0;
  return {
    id: stringField(note.noteId || note.id) || noteId,
    title,
    desc,
    author: stringField(user?.nickname || user?.nickName),
    tags,
    imageCount: images,
    video: note.type === "video",
    token: "",
    source: "",
  };
}

export function xiaohongshuMarkdown(note: XiaohongshuNote): string {
  const lines = [
    note.author ? `作者：${note.author}` : "",
    note.desc,
    note.tags.length ? note.tags.map((tag) => `#${tag}`).join(" ") : "",
    note.imageCount > 0 ? `图片：${note.imageCount} 张。这一版只收了文字。` : "",
    note.video ? "这是一条视频笔记。这一版收的是文案，没有转写口播。" : "",
  ];
  return lines.filter(Boolean).join("\n\n");
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function noteFromFeed(payload: unknown, noteId = ""): XiaohongshuNote | null {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
  const items = Array.isArray(data)
    ? data
    : (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : []);
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as { note_card?: Record<string, unknown>; note?: Record<string, unknown>; id?: unknown };
    const note = record.note_card || record.note;
    if (!note) continue;
    const title = stringField(note.title || note.display_title);
    const desc = stringField(note.desc);
    if (!title && !desc) continue;
    const user = note.user as { nickname?: string; nick_name?: string } | undefined;
    const tags = Array.isArray(note.tag_list)
      ? note.tag_list.map((tag) => stringField((tag as { name?: string }).name)).filter(Boolean)
      : [];
    const images = Array.isArray(note.image_list) ? note.image_list.length : 0;
    return {
      id: stringField(note.note_id || record.id) || noteId,
      title,
      desc,
      author: stringField(user?.nickname || user?.nick_name),
      tags,
      imageCount: images,
      video: note.type === "video",
      token: "",
      source: "",
    };
  }
  return null;
}

export function xhsLoggedInName(html: string): string | null {
  const state = initialStateFromHtml(html);
  const user = state?.user as { loggedIn?: boolean; userInfo?: { nickname?: string; nickName?: string } } | undefined;
  if (!user?.loggedIn) return null;
  return stringField(user.userInfo?.nickname || user.userInfo?.nickName) || null;
}

export type XhsQrState = "waiting" | "scanned" | "confirmed" | "expired";

export function xhsQrState(value: unknown): XhsQrState | null {
  const code = Number(value);
  if (code === 0) return "waiting";
  if (code === 1) return "scanned";
  if (code === 2) return "confirmed";
  if (code === 3) return "expired";
  return null;
}

export function xhsLoginUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (host !== "www.xiaohongshu.com" && host !== "xiaohongshu.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function cookieFromXhsConfirm(deviceCookie: string, setCookies: string[], loginInfo: unknown): string {
  const pairs = new Map<string, string>();
  const absorb = (text: string) => {
    const pair = text.split(";")[0]?.trim() ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) return;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (name && value) pairs.set(name, value);
  };
  absorb(deviceCookie);
  for (const part of deviceCookie.split(";")) absorb(part);
  for (const header of setCookies) absorb(header);
  const info = loginInfo && typeof loginInfo === "object"
    ? loginInfo as { session?: unknown; secure_session?: unknown }
    : {};
  const session = typeof info.session === "string" ? info.session.trim() : "";
  const secure = typeof info.secure_session === "string" ? info.secure_session.trim() : "";
  const webSession = session || secure.split("session.").pop() || "";
  if (webSession) pairs.set("web_session", webSession);
  if (!pairs.get("a1") || !pairs.get("web_session")) return "";
  return [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function nicknameFromSelfinfo(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const record = data as { nickname?: unknown; nick_name?: unknown; basic_info?: { nickname?: unknown } };
  return stringField(record.nickname || record.nick_name || record.basic_info?.nickname) || null;
}
