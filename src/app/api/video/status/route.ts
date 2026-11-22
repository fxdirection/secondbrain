import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getBilibiliCookiePath, loadUserConfig, normalizeVideoSettings } from "@/lib/storage";
import { bilibiliLoginName } from "@/lib/videoCapture";
import { whisperStatus } from "@/lib/whisper";

const WHISPER_CACHE_MS = 10 * 60 * 1000;
let whisperCache: { at: number; available: boolean; detail: string } | null = null;

export async function GET(request: Request): Promise<NextResponse> {
  const settings = normalizeVideoSettings(await loadUserConfig());
  const checkWhisper = new URL(request.url).searchParams.get("whisper") === "1";
  let cookie = "";
  try {
    cookie = (await fs.readFile(getBilibiliCookiePath(), "utf-8")).trim();
  } catch {
    cookie = "";
  }

  let nickname: string | null = null;
  if (cookie) {
    try {
      nickname = await bilibiliLoginName(cookie);
    } catch {
      nickname = null;
    }
  }

  const cacheFresh = whisperCache && Date.now() - whisperCache.at < WHISPER_CACHE_MS;
  if (checkWhisper && !cacheFresh) {
    const whisper = await whisperStatus();
    whisperCache = { at: Date.now(), available: whisper.available, detail: whisper.detail };
  }

  return NextResponse.json({
    success: true,
    cookieSaved: Boolean(cookie),
    nickname,
    whisperAvailable: whisperCache?.available ?? null,
    whisperDetail: whisperCache?.detail ?? "",
    whisperModel: settings.whisperModel,
    whisperLanguage: settings.whisperLanguage,
    deleteAudioAfter: settings.deleteAudioAfter,
  });
}
