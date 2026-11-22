import { createHash } from "crypto";

export const BILIBILI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export const BILIBILI_LOGIN_REQUIRED =
  "This video has no official subtitles. Sign in from Settings → Accounts, then capture it again.";

export const WHISPER_MISSING =
  "faster-whisper is not installed, so this video cannot be transcribed locally.";

export const CUDA_FAILED =
  "Local transcription failed on CUDA. The audio was not retried on CPU.";

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface BilibiliVideo {
  bvid: string;
  title: string;
  owner: string;
  cid: number;
  duration: number;
}

export interface SubtitleTrack {
  lang: string;
  url: string;
}

export function extractBvId(input: string): string | null {
  const match = input.match(/BV[0-9A-Za-z]+/);
  return match ? match[0] : null;
}

export function isBilibiliInput(input: string): boolean {
  return canonicalBilibiliUrl(input) !== null;
}

export function canonicalBilibiliUrl(input: string): string | null {
  const trimmed = input.trim();
  if (/^BV[0-9A-Za-z]+$/.test(trimmed)) {
    return `https://www.bilibili.com/video/${trimmed}`;
  }
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "b23.tv" || host === "bilibili.com" || host.endsWith(".bilibili.com")) {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

export function mixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((index) => raw[index] || "").join("").slice(0, 32);
}

export function imgKeyFromUrl(url: string): string {
  const name = url.split("/").pop() || "";
  return name.split(".")[0];
}

export function signWbi(
  params: Record<string, string | number>,
  imgKey: string,
  subKey: string,
  now = Date.now()
): string {
  const signed: Record<string, string> = {
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    wts: String(Math.round(now / 1000)),
  };
  const cleaned: Record<string, string> = {};
  for (const key of Object.keys(signed).sort()) {
    cleaned[key] = signed[key].replace(/[!'()*]/g, "");
  }
  const query = new URLSearchParams(cleaned).toString();
  const wRid = createHash("md5").update(query + mixinKey(imgKey, subKey)).digest("hex");
  return `${query}&w_rid=${wRid}`;
}

export function subtitleTracks(payload: unknown): SubtitleTrack[] {
  const list = (payload as {
    data?: { subtitle?: { subtitles?: { lan?: string; subtitle_url?: string }[] } };
  }).data?.subtitle?.subtitles ?? [];
  return list.flatMap((item) => {
    if (!item.subtitle_url) return [];
    const url = item.subtitle_url.startsWith("//") ? `https:${item.subtitle_url}` : item.subtitle_url;
    return [{ lang: item.lan || "", url }];
  });
}

export function preferredSubtitle(tracks: SubtitleTrack[]): SubtitleTrack | undefined {
  return tracks.find((track) => track.lang === "zh-CN")
    || tracks.find((track) => track.lang.startsWith("zh"))
    || tracks.find((track) => track.lang.includes("ai"))
    || tracks[0];
}

export function segmentsFromSubtitleJson(payload: unknown): TranscriptSegment[] {
  const body = (payload as { body?: { from?: number; to?: number; content?: string }[] }).body ?? [];
  return body
    .map((item) => ({
      start: item.from ?? 0,
      end: item.to ?? 0,
      text: (item.content || "").trim(),
    }))
    .filter((item) => item.text);
}

export function audioUrlFromPlayer(payload: unknown): string | null {
  const data = (payload as {
    data?: {
      dash?: {
        audio?: { baseUrl?: string; base_url?: string; bandwidth?: number }[];
        dolby?: { audio?: { baseUrl?: string; base_url?: string; bandwidth?: number }[] };
        flac?: { audio?: { baseUrl?: string; base_url?: string; bandwidth?: number } };
      };
      durl?: { url?: string }[];
    };
  }).data;
  const tracks = [
    ...(data?.dash?.audio ?? []),
    ...(data?.dash?.dolby?.audio ?? []),
    ...(data?.dash?.flac?.audio ? [data.dash.flac.audio] : []),
  ];
  const usable = tracks
    .map((audio) => ({ url: audio.baseUrl || audio.base_url || "", bandwidth: audio.bandwidth ?? Number.MAX_SAFE_INTEGER }))
    .filter((audio) => audio.url);
  usable.sort((a, b) => a.bandwidth - b.bandwidth);
  if (usable[0]?.url) return usable[0].url;
  return data?.durl?.find((item) => item.url)?.url ?? null;
}

export type TranscriptStep = "use-official" | "need-login" | "use-cookie" | "transcribe";

export function nextTranscriptStep(
  official: TranscriptSegment[],
  hasCookie: boolean,
  withCookie: TranscriptSegment[] | null
): TranscriptStep {
  if (official.length > 0) return "use-official";
  if (!hasCookie) return "need-login";
  if (withCookie && withCookie.length > 0) return "use-cookie";
  return "transcribe";
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatSrtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

export function segmentsToMarkdown(video: Pick<BilibiliVideo, "owner" | "duration">, segments: TranscriptSegment[]): string {
  const header = [
    video.owner ? `Uploader: ${video.owner}` : "",
    `Duration: ${formatTimestamp(video.duration)}`,
    "",
  ].filter((line, index, all) => line || index === all.length - 1);
  const body = segments.map((segment) => `${formatTimestamp(segment.start)}\n${segment.text}`);
  return [...header, ...body].join("\n\n");
}

export function segmentsToSrt(segments: TranscriptSegment[]): string {
  return segments.map((segment, index) => (
    `${index + 1}\n${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.end)}\n${segment.text}\n`
  )).join("\n");
}

export function transcriptBody(markdown: string): string {
  const lines = markdown.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return false;
    if (trimmed.startsWith("Uploader:") || trimmed.startsWith("Duration:")) return false;
    return true;
  });
  return lines.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function textChunks(text: string, limit = 12000): string[] {
  if (text.length <= limit) return text ? [text] : [];
  const parts: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n\n+/)) {
    const piece = paragraph.trim();
    if (!piece) continue;
    if (piece.length > limit) {
      if (current) parts.push(current);
      for (let index = 0; index < piece.length; index += limit) parts.push(piece.slice(index, index + limit));
      current = "";
      continue;
    }
    if (current && current.length + piece.length + 2 > limit) {
      parts.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function sampleTranscript(text: string, limit = 18000): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.5);
  const middle = Math.floor(limit * 0.25);
  const tail = limit - head - middle;
  const midStart = Math.max(0, Math.floor((text.length - middle) / 2));
  return [
    text.slice(0, head),
    "[...]",
    text.slice(midStart, midStart + middle),
    "[...]",
    text.slice(-tail),
  ].join("\n\n");
}
