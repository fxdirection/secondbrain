import { describe, expect, it } from "vitest";
import {
  canonicalYouTubeUrl,
  parseYouTubeId,
  playerResponseFromWatchHtml,
  segmentsFromTranscriptJson,
} from "@/lib/youtube";

describe("youtube links", () => {
  it("recognizes watch, short, and share links", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=jNQXAC9IVRw&t=3")).toBe("jNQXAC9IVRw");
    expect(parseYouTubeId("https://youtu.be/jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
    expect(canonicalYouTubeUrl("https://www.youtube.com/shorts/jNQXAC9IVRw")).toBe("https://www.youtube.com/watch?v=jNQXAC9IVRw");
    expect(parseYouTubeId("https://example.com/watch?v=jNQXAC9IVRw")).toBeNull();
  });

  it("reads the title from the watch page player response", () => {
    const video = playerResponseFromWatchHtml('prefix ytInitialPlayerResponse = {"videoDetails":{"videoId":"jNQXAC9IVRw","title":"Me at the zoo","author":"jawed","lengthSeconds":"19"}}; tail');
    expect(video).toEqual({ id: "jNQXAC9IVRw", title: "Me at the zoo", author: "jawed", duration: 19 });
  });

  it("parses caption json from the local script", () => {
    expect(segmentsFromTranscriptJson('log\n[{"start":1,"end":2.5,"text":"hello"}]')).toEqual([
      { start: 1, end: 2.5, text: "hello" },
    ]);
  });
});
