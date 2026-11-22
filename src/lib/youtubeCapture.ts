import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { segmentsToMarkdown, segmentsToSrt } from "./bilibili";
import { transcribeAudio, runCommand } from "./whisper";
import { updatePendingTitle, getLibraryPath, loadUserConfig, normalizeVideoSettings, writeSourceProgress } from "./storage";
import {
  YouTubeSegment,
  canonicalYouTubeUrl,
  parseYouTubeId,
  playerResponseFromWatchHtml,
  segmentsFromTranscriptJson,
} from "./youtube";

const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const NO_CAPTIONS = "This YouTube video has no captions, and the audio track could not be downloaded for local transcription.";
const AGE_RESTRICTED = "This YouTube video is age-restricted. Public captions are hidden, and a YouTube login is not available yet.";
const UNAVAILABLE = "YouTube could not find this video.";

function captionScript(): string {
  return path.join(process.cwd(), "src", "lib", "youtube_captions.py");
}

async function watchMetadata(videoId: string): Promise<{ title: string; author: string; duration: number }> {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { "User-Agent": YOUTUBE_USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
  });
  if (response.ok) {
    const parsed = playerResponseFromWatchHtml(await response.text());
    if (parsed) return parsed;
  }
  const oembed = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
  if (!oembed.ok) throw new Error(UNAVAILABLE);
  const data = await oembed.json() as { title?: string; author_name?: string };
  if (!data.title) throw new Error(UNAVAILABLE);
  return { title: data.title, author: data.author_name || "", duration: 0 };
}

async function officialCaptions(videoId: string): Promise<YouTubeSegment[] | "age" | "missing" | "gone"> {
  const result = await runCommand("python", [
    captionScript(),
    videoId,
    "zh-Hans,zh-Hant,zh-CN,zh,en",
  ], 120_000);
  if (result.code === 0) return segmentsFromTranscriptJson(result.stdout);
  if (result.stderr.includes("AGE_RESTRICTED")) return "age";
  if (result.stderr.includes("UNAVAILABLE")) return "gone";
  if (result.stderr.includes("NO_CAPTIONS") || result.code === 2) return "missing";
  throw new Error(result.stderr.trim().slice(-180) || "YouTube captions could not be read.");
}

async function transcribeFromAudio(id: string, videoUrl: string): Promise<YouTubeSegment[]> {
  const template = path.join(os.tmpdir(), `secondbrain-yt-${id}.%(ext)s`);
  const download = await runCommand("python", [
    "-m", "yt_dlp",
    "-f", "ba/bestaudio",
    "--no-playlist",
    "--no-warnings",
    "-o", template,
    videoUrl,
  ], 10 * 60 * 1000);
  const files = (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith(`secondbrain-yt-${id}.`));
  const audioPath = files[0] ? path.join(os.tmpdir(), files[0]) : "";
  if (download.code !== 0 || !audioPath) {
    throw new Error(NO_CAPTIONS);
  }
  const settings = normalizeVideoSettings(await loadUserConfig());
  await writeSourceProgress(id, "Transcribing audio");
  try {
    return await transcribeAudio(audioPath, settings);
  } finally {
    if (settings.deleteAudioAfter) await fs.unlink(audioPath).catch(() => undefined);
    else {
      const dest = path.join(getLibraryPath(), id, `audio${path.extname(audioPath) || ".m4a"}`);
      await fs.rename(audioPath, dest).catch(async () => {
        await fs.copyFile(audioPath, dest).catch(() => undefined);
        await fs.unlink(audioPath).catch(() => undefined);
      });
    }
  }
}

export async function captureYouTubeVideo(id: string, input: string): Promise<{ title: string; markdown: string; srt: string; url: string }> {
  const videoId = parseYouTubeId(input);
  if (!videoId) throw new Error("This YouTube link does not point at a video.");
  const meta = await watchMetadata(videoId);
  await updatePendingTitle(id, meta.title).catch(() => undefined);
  await writeSourceProgress(id, "Reading captions");
  const captions = await officialCaptions(videoId);
  if (captions === "age") throw new Error(AGE_RESTRICTED);
  if (captions === "gone") throw new Error(UNAVAILABLE);
  const url = canonicalYouTubeUrl(input) || `https://www.youtube.com/watch?v=${videoId}`;
  let segments = Array.isArray(captions) ? captions : [];
  if (segments.length === 0) {
    await writeSourceProgress(id, "Downloading audio");
    segments = await transcribeFromAudio(id, url);
  }
  if (segments.length === 0) throw new Error(NO_CAPTIONS);
  return {
    title: meta.title,
    markdown: segmentsToMarkdown({ owner: meta.author, duration: meta.duration }, segments),
    srt: segmentsToSrt(segments),
    url,
  };
}
