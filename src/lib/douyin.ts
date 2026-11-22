import { createHash } from "crypto";
import { formatTimestamp, segmentsToMarkdown, TranscriptSegment } from "./bilibili";

export const DOUYIN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export const DOUYIN_NOT_FOUND = "Douyin could not find this video.";
export const DOUYIN_NO_MEDIA = "Douyin did not provide a caption or an audio track for this video.";
export const DOUYIN_BAD_LINK = "This Douyin link does not point at a video.";

const SIGN_SALT = "A96D855A08C0A9707F8BEF0D9A527E4E";

export interface DouyinVideo {
  id: string;
  title: string;
  author: string;
  duration: number;
  mediaUrls: string[];
  captionUrl: string;
}

export function parseDouyinId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!isDouyinHost(url.hostname)) return null;
  const modalId = url.searchParams.get("modal_id") || "";
  if (/^[0-9]{8,22}$/.test(modalId)) return modalId;
  const match = url.pathname.match(/\/(?:video|note|share\/video)\/([0-9]{8,22})/);
  return match ? match[1] : null;
}

export function isDouyinShortLink(input: string): boolean {
  try {
    const host = new URL(input.trim()).hostname.toLowerCase().replace(/^www\./, "");
    return host === "v.douyin.com" || host === "iesdouyin.com";
  } catch {
    return false;
  }
}

export function canonicalDouyinUrl(input: string): string | null {
  const found = firstDouyinUrl(input);
  if (!found) return null;
  const id = parseDouyinId(found);
  if (id) return `https://www.douyin.com/video/${id}`;
  if (isDouyinShortLink(found)) return found;
  return null;
}

export function isDouyinInput(input: string): boolean {
  return canonicalDouyinUrl(input) !== null;
}

export function douyinDetailUrl(videoId: string, uifid: string, now = Date.now()): string {
  const timestamp = Math.floor(now / 1000);
  const query = `aweme_id=${videoId}&aid=6383&uifid=${encodeURIComponent(uifid)}&timestamp=${timestamp}`;
  const plain = `${uifid}_${timestamp}_${SIGN_SALT}_${query}`;
  const signature = createHash("md5").update(plain).digest("hex");
  return `https://www.douyin.com/aweme/v1/web/aweme/detail/?${query}&x-secsdk-web-signature=${signature}`;
}

export function videoFromDetail(payload: unknown, videoId = ""): DouyinVideo | null {
  const item = payload && typeof payload === "object"
    ? (payload as { aweme_detail?: Record<string, unknown> }).aweme_detail
    : null;
  if (!item) return null;
  const author = item.author as { nickname?: unknown } | undefined;
  const video = item.video as { bit_rate?: unknown } | undefined;
  const title = textOf(item.desc);
  const id = textOf(item.aweme_id) || videoId;
  if (!id || (!title && !video)) return null;
  return {
    id,
    title: title || "抖音视频",
    author: textOf(author?.nickname),
    duration: douyinDurationSeconds(item.duration),
    mediaUrls: mediaUrlsFromVideo(video),
    captionUrl: captionUrlFromItem(item),
  };
}

export function segmentsFromCaption(text: string): TranscriptSegment[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return segmentsFromCaptionJson(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return segmentsFromTimedText(trimmed);
}

export function douyinMarkdown(video: Pick<DouyinVideo, "title" | "author" | "duration">, segments: TranscriptSegment[]): string {
  const spoken = segmentsToMarkdown({ owner: video.author, duration: video.duration }, segments);
  const durationLabel = `Duration: ${formatTimestamp(video.duration)}`;
  if (!video.title) return spoken.trim();
  if (!spoken.includes(durationLabel)) return `${video.title}\n\n${spoken}`.trim();
  return spoken.replace(durationLabel, `${durationLabel}\n\n${video.title}`).trim();
}

function firstDouyinUrl(input: string): string | null {
  const trimmed = input.trim();
  const matches = trimmed.match(/https?:\/\/[^\s<>"]+/g) || [trimmed];
  for (const match of matches) {
    const cleaned = match.replace(/[)\]}>，。,.]+$/g, "");
    try {
      if (isDouyinHost(new URL(cleaned).hostname)) return cleaned;
    } catch {
      continue;
    }
  }
  return null;
}

function isDouyinHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return host === "douyin.com" || host.endsWith(".douyin.com") || host === "iesdouyin.com";
}

function douyinDurationSeconds(value: unknown): number {
  const duration = Number(value) || 0;
  if (duration <= 0) return 0;
  return Math.round(duration > 1000 ? duration / 1000 : duration);
}

function mediaUrlsFromVideo(video: { bit_rate?: unknown } | undefined): string[] {
  const tracks = Array.isArray(video?.bit_rate) ? video.bit_rate : [];
  return tracks
    .map((track) => {
      const item = track as { bit_rate?: unknown; play_addr?: { url_list?: unknown } };
      const urls = Array.isArray(item.play_addr?.url_list) ? item.play_addr.url_list : [];
      return {
        rate: Number(item.bit_rate) || Number.MAX_SAFE_INTEGER,
        urls: urls.filter((url): url is string => typeof url === "string" && url.startsWith("https://")),
      };
    })
    .filter((track) => track.urls.length > 0)
    .sort((left, right) => left.rate - right.rate)
    .flatMap((track) => track.urls);
}

function captionUrlFromItem(item: Record<string, unknown>): string {
  const found: { lang: string; url: string }[] = [];
  const stickers = Array.isArray(item.interaction_stickers) ? item.interaction_stickers : [];
  for (const sticker of stickers) {
    const info = (sticker as { auto_video_caption_info?: { auto_captions?: unknown } }).auto_video_caption_info;
    const captions = Array.isArray(info?.auto_captions) ? info.auto_captions : [];
    for (const caption of captions) {
      const record = caption as { language?: unknown; lang?: unknown; url?: { url_list?: unknown } };
      const urls = Array.isArray(record.url?.url_list) ? record.url.url_list : [];
      const url = urls.find((value): value is string => typeof value === "string" && value.startsWith("https://"));
      if (url) found.push({ lang: textOf(record.language || record.lang), url });
    }
  }
  const video = item.video as { cla_info?: { caption_infos?: unknown }; subtitleInfos?: unknown } | undefined;
  const infos = Array.isArray(video?.cla_info?.caption_infos) ? video.cla_info.caption_infos : [];
  for (const caption of infos) {
    const record = caption as { lang?: unknown; language?: unknown; url?: unknown };
    if (typeof record.url === "string" && record.url.startsWith("https://")) {
      found.push({ lang: textOf(record.lang || record.language), url: record.url });
    }
  }
  const subtitles = Array.isArray(video?.subtitleInfos) ? video.subtitleInfos : [];
  for (const caption of subtitles) {
    const record = caption as { LanguageCodeName?: unknown; Url?: unknown };
    if (typeof record.Url === "string" && record.Url.startsWith("https://")) {
      found.push({ lang: textOf(record.LanguageCodeName), url: record.Url });
    }
  }
  const preferred = found.find((item) => /zh|cn/i.test(item.lang));
  return (preferred || found[0])?.url || "";
}

function segmentsFromCaptionJson(payload: unknown): TranscriptSegment[] {
  const utterances = findUtterances(payload);
  return utterances
    .map((line) => ({
      start: Number(line.start_time || 0) / 1000,
      end: Number(line.end_time || 0) / 1000,
      text: textOf(line.text),
    }))
    .filter((line) => line.text);
}

function findUtterances(payload: unknown): { start_time?: unknown; end_time?: unknown; text?: unknown }[] {
  if (Array.isArray(payload)) {
    if (payload.every((item) => item && typeof item === "object" && "text" in item)) {
      return payload as { start_time?: unknown; end_time?: unknown; text?: unknown }[];
    }
    for (const item of payload) {
      const found = findUtterances(item);
      if (found.length) return found;
    }
    return [];
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { utterances?: unknown; data?: unknown };
  if (Array.isArray(record.utterances)) return findUtterances(record.utterances);
  if (record.data) return findUtterances(record.data);
  return [];
}

function segmentsFromTimedText(text: string): TranscriptSegment[] {
  const matches = text.matchAll(
    /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+([\s\S]*?)(?=\n\s*\n|\n\d+\s*\n|$)/g
  );
  const segments: TranscriptSegment[] = [];
  for (const match of matches) {
    const line = match[9].replace(/<[^>]+>/g, "").trim();
    if (!line) continue;
    segments.push({
      start: Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000,
      end: Number(match[5]) * 3600 + Number(match[6]) * 60 + Number(match[7]) + Number(match[8]) / 1000,
      text: line,
    });
  }
  return segments;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
