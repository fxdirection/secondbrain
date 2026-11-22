import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalDouyinUrl,
  douyinDetailUrl,
  douyinMarkdown,
  isDouyinInput,
  parseDouyinId,
  segmentsFromCaption,
  videoFromDetail,
} from "@/lib/douyin";

describe("douyin links", () => {
  it("recognizes a video link, a modal link, and a shared short link", () => {
    expect(parseDouyinId("https://www.douyin.com/video/6961737553342991651")).toBe("6961737553342991651");
    expect(canonicalDouyinUrl("https://www.douyin.com/user/abc?modal_id=6961737553342991651")).toBe(
      "https://www.douyin.com/video/6961737553342991651"
    );
    expect(canonicalDouyinUrl("7.43 复制打开抖音 https://v.douyin.com/abc/ ，")).toBe("https://v.douyin.com/abc/");
    expect(isDouyinInput("https://www.iesdouyin.com/share/video/6961737553342991651")).toBe(true);
    expect(canonicalDouyinUrl("https://example.com/video/6961737553342991651")).toBeNull();
  });

  it("signs the public detail request", () => {
    const timestamp = 1700000000;
    const query = `aweme_id=100&aid=6383&uifid=abc&timestamp=${timestamp}`;
    const signature = createHash("md5")
      .update(`abc_${timestamp}_A96D855A08C0A9707F8BEF0D9A527E4E_${query}`)
      .digest("hex");
    expect(douyinDetailUrl("100", "abc", timestamp * 1000)).toBe(
      `https://www.douyin.com/aweme/v1/web/aweme/detail/?${query}&x-secsdk-web-signature=${signature}`
    );
  });

  it("reads the description, the smallest media url, and caption lines", () => {
    const video = videoFromDetail({
      aweme_detail: {
        aweme_id: "6961737553342991651",
        desc: "标题",
        duration: 19782,
        author: { nickname: "甲" },
        video: {
          bit_rate: [
            { bit_rate: 200, play_addr: { url_list: ["https://cdn.example/high.mp4"] } },
            { bit_rate: 50, play_addr: { url_list: ["https://cdn.example/low.mp4"] } },
          ],
        },
        interaction_stickers: [{
          auto_video_caption_info: {
            auto_captions: [{ language: "zh-CN", url: { url_list: ["https://cdn.example/cap.json"] } }],
          },
        }],
      },
    });
    expect(video?.title).toBe("标题");
    expect(video?.author).toBe("甲");
    expect(video?.duration).toBe(20);
    expect(video?.mediaUrls[0]).toBe("https://cdn.example/low.mp4");
    expect(video?.captionUrl).toBe("https://cdn.example/cap.json");
    const segments = segmentsFromCaption(JSON.stringify({
      utterances: [{ start_time: 0, end_time: 1500, text: "你好" }],
    }));
    expect(segments).toEqual([{ start: 0, end: 1.5, text: "你好" }]);
    expect(douyinMarkdown(video!, segments)).toContain("标题");
    expect(douyinMarkdown(video!, segments)).toContain("你好");
  });
});
