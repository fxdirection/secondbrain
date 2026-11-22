import { describe, expect, it } from "vitest";
import {
  canonicalXiaohongshuUrl,
  cookieFromXhsConfirm,
  isXiaohongshuInput,
  nicknameFromSelfinfo,
  noteFromFeed,
  noteFromHtml,
  parseXiaohongshuUrl,
  xhsLoginUrl,
  xhsQrState,
  xiaohongshuMarkdown,
} from "@/lib/xiaohongshu";

describe("xiaohongshu links", () => {
  it("recognizes a note link and a short link", () => {
    expect(parseXiaohongshuUrl("https://www.xiaohongshu.com/explore/abc123?xsec_token=tok&xsec_source=pc_share")).toEqual({
      id: "abc123",
      token: "tok",
      source: "pc_share",
    });
    expect(canonicalXiaohongshuUrl("https://www.xiaohongshu.com/discovery/item/abc123?xsec_token=tok")).toBe(
      "https://www.xiaohongshu.com/explore/abc123?xsec_token=tok"
    );
    expect(isXiaohongshuInput("https://xhslink.com/a/xyz")).toBe(true);
    expect(parseXiaohongshuUrl("https://example.com/explore/abc123")).toBeNull();
  });

  it("reads the note text out of the page state", () => {
    const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"abc123":{"note":{"noteId":"abc123","title":"标题","desc":"正文","type":"normal","user":{"nickname":"甲"},"tagList":[{"name":"标签"}],"imageList":[{},{}]}}}}}</script>`;
    const note = noteFromHtml(html, "abc123");
    expect(note?.title).toBe("标题");
    expect(note?.author).toBe("甲");
    expect(xiaohongshuMarkdown(note!)).toContain("正文");
    expect(xiaohongshuMarkdown(note!)).toContain("#标签");
    expect(xiaohongshuMarkdown(note!)).toContain("图片：2 张");
  });

  it("reads a note returned by the feed api", () => {
    const note = noteFromFeed({
      data: {
        items: [{
          id: "abc123",
          note_card: {
            note_id: "abc123",
            title: "标题",
            desc: "正文",
            type: "normal",
            user: { nickname: "甲" },
            tag_list: [{ name: "标签" }],
            image_list: [{}, {}],
          },
        }],
      },
    });
    expect(note?.title).toBe("标题");
    expect(note?.author).toBe("甲");
    expect(xiaohongshuMarkdown(note!)).toContain("正文");
  });

  it("turns a confirmed scan into a local session cookie", () => {
    expect(xhsQrState(0)).toBe("waiting");
    expect(xhsQrState(1)).toBe("scanned");
    expect(xhsQrState(2)).toBe("confirmed");
    expect(xhsQrState(3)).toBe("expired");
    expect(xhsLoginUrl("https://www.xiaohongshu.com/mobile/login?qrId=1")).toContain("qrId=1");
    expect(xhsLoginUrl("https://example.com/mobile/login")).toBeNull();
    expect(cookieFromXhsConfirm(
      "a1=device; webId=abc",
      ["gid=ggg; Path=/"],
      { session: "sess" }
    )).toBe("a1=device; webId=abc; gid=ggg; web_session=sess");
    expect(cookieFromXhsConfirm("a1=device", [], {})).toBe("");
    expect(nicknameFromSelfinfo({ success: true, data: { nickname: "甲" } })).toBe("甲");
  });
});
