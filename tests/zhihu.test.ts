import { describe, expect, it } from "vitest";
import {
  canonicalZhihuUrl,
  cookiePair,
  parseZhihuUrl,
  zhihuHtmlToMarkdown,
} from "@/lib/zhihu";
import { signZhihuRequest } from "@/lib/zhihuSign";
import { zhihuScanState, zhihuVerifyUrl } from "@/lib/zhihuLogin";

describe("zhihu links", () => {
  it("recognizes a column, an answer, and a question", () => {
    expect(parseZhihuUrl("https://zhuanlan.zhihu.com/p/2103481316800984480")).toEqual({
      kind: "article",
      id: "2103481316800984480",
    });
    expect(parseZhihuUrl("https://www.zhihu.com/question/1/answer/2?utm_source=1")).toEqual({
      kind: "answer",
      questionId: "1",
      id: "2",
    });
    expect(canonicalZhihuUrl("https://zhihu.com/question/99")).toBe("https://www.zhihu.com/question/99");
    expect(parseZhihuUrl("https://example.com/question/1")).toBeNull();
  });

  it("reads a cookie value that contains an equals sign", () => {
    expect(cookiePair("d_c0=abc=|170; z_c0=token", "d_c0")).toBe("abc=|170");
    expect(cookiePair("d_c0=abc=|170; z_c0=token", "z_c0")).toBe("token");
  });

  it("turns Zhihu HTML into markdown without dropping the sentence", () => {
    const markdown = zhihuHtmlToMarkdown("<p>公平无法计算</p><h2>退让</h2><p>谁算谁亏</p>");
    expect(markdown).toContain("公平无法计算");
    expect(markdown).toContain("### 退让");
    expect(markdown).toContain("谁算谁亏");
    expect(markdown).not.toContain("<p>");
  });

  it("reads scan states and only accepts a Zhihu verification page", () => {
    expect(zhihuScanState({ status: 0 })).toBe("waiting");
    expect(zhihuScanState({ status: 1 })).toBe("scanned");
    expect(zhihuScanState({ status: 2 })).toBe("confirmed");
    expect(zhihuScanState({ status: 3 })).toBe("expired");
    expect(zhihuScanState({ error: { code: 40352 } })).toBe("blocked");
    expect(zhihuVerifyUrl("https://www.zhihu.com/account/unhuman?type=1")).toBe("https://www.zhihu.com/account/unhuman?type=1");
    expect(zhihuVerifyUrl("https://example.com/account/unhuman")).toBeNull();
  });

  it("signs a request with the zse headers", () => {
    const headers = signZhihuRequest("https://www.zhihu.com/api/v4/articles/1", "abc|1700000000");
    expect(headers["x-zse-93"]).toBe("101_3_3.0");
    expect(headers["x-requested-with"]).toBe("fetch");
    expect(headers["x-zse-96"]).toMatch(/^2\.0_.+/);
  });
});
