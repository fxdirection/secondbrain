import { describe, expect, it } from "vitest";
import {
  audioUrlFromPlayer,
  canonicalBilibiliUrl,
  extractBvId,
  nextTranscriptStep,
  sampleTranscript,
  textChunks,
  transcriptBody,
  segmentsToMarkdown,
  segmentsToSrt,
  signWbi,
} from "@/lib/bilibili";
import { segmentsFromWhisperStdout, whisperFailure, whisperLaunchArgs } from "@/lib/whisper";
import { normalizeVideoSettings } from "@/lib/storage";
import { CUDA_FAILED, WHISPER_MISSING } from "@/lib/bilibili";
import {
  cookieFromLoginUrl,
  cookieHeaderFromSetCookie,
  isQrcodeKey,
  mergeCookieHeaders,
  pollQrLogin,
  qrLoginState,
} from "@/lib/bilibiliLogin";

describe("bilibili links", () => {
  it("recognizes a video page, a short link, and a bare BV id", () => {
    expect(extractBvId("https://www.bilibili.com/video/BV1H4sJ6XEF5")).toBe("BV1H4sJ6XEF5");
    expect(canonicalBilibiliUrl("BV1H4sJ6XEF5")).toBe("https://www.bilibili.com/video/BV1H4sJ6XEF5");
    expect(canonicalBilibiliUrl("https://b23.tv/abc")).toBe("https://b23.tv/abc");
    expect(canonicalBilibiliUrl("https://example.com/BV1H4sJ6XEF5")).toBeNull();
  });

  it("reads the lowest dash audio track and ignores a player response without one", () => {
    expect(audioUrlFromPlayer({ data: { subtitle: { subtitles: [] } } })).toBeNull();
    expect(audioUrlFromPlayer({
      data: {
        dash: {
          audio: [
            { baseUrl: "https://cdn.example/high", bandwidth: 300000 },
            { baseUrl: "https://cdn.example/low", bandwidth: 60000 },
          ],
        },
      },
    })).toBe("https://cdn.example/low");
    expect(audioUrlFromPlayer({ data: { durl: [{ url: "https://cdn.example/legacy.mp4" }] } })).toBe("https://cdn.example/legacy.mp4");
  });

  it("asks for a cookie when official subtitles are empty", () => {
    expect(nextTranscriptStep([], false, null)).toBe("need-login");
    expect(nextTranscriptStep([], true, [])).toBe("transcribe");
    expect(nextTranscriptStep([{ start: 0, end: 1, text: "hello" }], false, null)).toBe("use-official");
    expect(nextTranscriptStep([], true, [{ start: 0, end: 1, text: "signed in" }])).toBe("use-cookie");
  });

  it("writes markdown and srt from the same segments", () => {
    const segments = [{ start: 12, end: 15.5, text: "亲密关系" }];
    const markdown = segmentsToMarkdown({ owner: "橙海飞鸟", duration: 1717 }, segments);
    expect(markdown).toContain("Uploader: 橙海飞鸟");
    expect(markdown).toContain("00:00:12");
    expect(markdown).toContain("亲密关系");
    expect(segmentsToSrt(segments)).toContain("00:00:12,000 --> 00:00:15,500");
  });

  it("drops timestamps before the transcript is organized", () => {
    const plain = transcriptBody("Uploader: 橙海飞鸟\n\nDuration: 00:28:37\n\n00:00:12\n亲密关系\n\n00:00:20\n谁都觉得自己亏");
    expect(plain).toBe("亲密关系\n\n谁都觉得自己亏");
    expect(textChunks("a".repeat(10), 4)).toEqual(["aaaa", "aaaa", "aa"]);
  });

  it("samples the opening, middle, and ending of a long transcript", () => {
    const text = `${"a".repeat(10000)}${"b".repeat(10000)}${"c".repeat(10000)}`;
    const sample = sampleTranscript(text, 1800);
    expect(sample.startsWith("a")).toBe(true);
    expect(sample.endsWith("c")).toBe(true);
    expect(sample).toContain("[...]");
    expect(sample.length).toBeLessThan(text.length);
  });

  it("signs a wbi query without copying a placeholder id", () => {
    const signed = signWbi({ bvid: "BV1H4sJ6XEF5", cid: 1 }, "a".repeat(32), "b".repeat(32), 1_700_000_000_000);
    expect(signed).toContain("wts=1700000000");
    expect(signed).toMatch(/w_rid=[0-9a-f]{32}$/);
  });
});

describe("whisper command", () => {
  it("asks the local script for large-v3 on the audio file", () => {
    const args = whisperLaunchArgs(
      normalizeVideoSettings({}),
      "C:/tmp/secondbrain-demo.m4a"
    );
    expect(args[0]).toMatch(/transcribe_whisper\.py$/);
    expect(args.slice(1)).toEqual(["large-v3", "C:/tmp/secondbrain-demo.m4a", "zh"]);
  });

  it("parses transcript json and keeps CUDA failures on CUDA", () => {
    expect(segmentsFromWhisperStdout('log\n[{"start":1,"end":2,"text":"你好"}]')).toEqual([
      { start: 1, end: 2, text: "你好" },
    ]);
    expect(whisperFailure("CUDA out of memory").message).toBe(CUDA_FAILED);
    expect(whisperFailure("ModuleNotFoundError: No module named 'faster_whisper'").message).toBe(WHISPER_MISSING);
  });
});

describe("bilibili qr login", () => {
  it("maps the scan states and accepts a 32-character key", () => {
    expect(qrLoginState(86101)).toBe("waiting");
    expect(qrLoginState(86090)).toBe("scanned");
    expect(qrLoginState(86038)).toBe("expired");
    expect(qrLoginState(0)).toBe("confirmed");
    expect(qrLoginState("nope")).toBeNull();
    expect(isQrcodeKey("0daab3a5e70dd95bbd51fbf421bbe434")).toBe(true);
    expect(isQrcodeKey("not a key")).toBe(false);
  });

  it("keeps the encoded session and drops cookie attributes", () => {
    const header = cookieHeaderFromSetCookie([
      "SESSDATA=abc%2C123; Path=/; Domain=.bilibili.com; HttpOnly",
      "bili_jct=jct; Path=/",
    ]);
    expect(header).toContain("SESSDATA=abc%2C123");
    expect(header).toContain("bili_jct=jct");
    expect(header).not.toContain("HttpOnly");
    const fromUrl = cookieFromLoginUrl(
      "https://passport.bilibili.com/x/passport-login/web/crossDomain?DedeUserID=1&SESSDATA=abc%2C123&gourl=https%3A%2F%2Fwww.bilibili.com"
    );
    expect(fromUrl).toContain("SESSDATA=abc%2C123");
    expect(fromUrl).toContain("DedeUserID=1");
    expect(fromUrl).not.toContain("gourl=");
    expect(mergeCookieHeaders("SESSDATA=old; bili_jct=jct", "SESSDATA=new")).toBe("SESSDATA=new; bili_jct=jct");
  });

  it("reads the session from the poll response and ignores an unsigned scan", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/qrcode/poll?")) {
        const headers = new Headers();
        headers.append("set-cookie", "SESSDATA=abc%2C123; Path=/; HttpOnly");
        headers.append("set-cookie", "bili_jct=jct; Path=/");
        return new Response(JSON.stringify({
          code: 0,
          data: {
            code: 0,
            url: "https://passport.bilibili.com/x/passport-login/web/crossDomain?SESSDATA=from-url&bili_jct=from-url",
            message: "",
          },
        }), { status: 200, headers });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const confirmed = await pollQrLogin("0daab3a5e70dd95bbd51fbf421bbe434", fetchImpl);
    expect(confirmed.state).toBe("confirmed");
    expect(confirmed.cookie).toContain("SESSDATA=abc%2C123");
    expect(confirmed.cookie).not.toContain("SESSDATA=from-url");

    const waiting = await pollQrLogin("0daab3a5e70dd95bbd51fbf421bbe434", (async () => new Response(JSON.stringify({
      code: 0,
      data: { code: 86101, url: "", message: "未扫码" },
    }), { status: 200 })) as typeof fetch);
    expect(waiting).toEqual({ state: "waiting", cookie: null });
  });
});
