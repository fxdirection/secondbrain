export interface YouTubeVideo {
  id: string;
  title: string;
  author: string;
  duration: number;
}

export interface YouTubeSegment {
  start: number;
  end: number;
  text: string;
}

export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] || "";
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "music.youtube.com") return null;
  const fromQuery = url.searchParams.get("v") || "";
  if (/^[\w-]{11}$/.test(fromQuery)) return fromQuery;
  const fromPath = url.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
  return fromPath ? fromPath[1] : null;
}

export function isYouTubeInput(input: string): boolean {
  return parseYouTubeId(input) !== null;
}

export function canonicalYouTubeUrl(input: string): string | null {
  const id = parseYouTubeId(input);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

export function playerResponseFromWatchHtml(html: string): YouTubeVideo | null {
  const marker = html.indexOf("ytInitialPlayerResponse");
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
    const data = JSON.parse(html.slice(jsonStart, end)) as {
      videoDetails?: { videoId?: string; title?: string; author?: string; lengthSeconds?: string };
    };
    const details = data.videoDetails;
    if (!details?.videoId || !details.title) return null;
    return {
      id: details.videoId,
      title: details.title,
      author: details.author || "",
      duration: Number(details.lengthSeconds) || 0,
    };
  } catch {
    return null;
  }
}

export function segmentsFromTranscriptJson(stdout: string): YouTubeSegment[] {
  const match = stdout.match(/\[[\s\S]*\]/);
  if (!match) return [];
  const parsed = JSON.parse(match[0]) as { start?: number; end?: number; text?: string }[];
  return parsed
    .map((item) => ({
      start: item.start ?? 0,
      end: item.end ?? 0,
      text: (item.text || "").replace(/\s+/g, " ").trim(),
    }))
    .filter((item) => item.text);
}
