export const ZHIHU_LOGIN_REQUIRED =
  "This Zhihu post is only visible after login. Sign in from Settings → Accounts, then capture it again.";

export const ZHIHU_LOGIN_REJECTED =
  "Zhihu did not accept the saved login. Paste a Cookie header that includes both d_c0 and z_c0 from the same browser.";

export interface ZhihuTarget {
  kind: "article" | "answer" | "question";
  id: string;
  questionId?: string;
}

export function parseZhihuUrl(input: string): ZhihuTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "zhihu.com" && host !== "zhuanlan.zhihu.com") return null;
  const article = url.pathname.match(/\/(?:p|art)\/(\d+)/);
  if (article) return { kind: "article", id: article[1] };
  const answer = url.pathname.match(/\/question\/(\d+)\/answer\/(\d+)/);
  if (answer) return { kind: "answer", questionId: answer[1], id: answer[2] };
  const bareAnswer = url.pathname.match(/\/answer\/(\d+)/);
  if (bareAnswer) return { kind: "answer", id: bareAnswer[1] };
  const question = url.pathname.match(/\/question\/(\d+)/);
  if (question) return { kind: "question", id: question[1] };
  return null;
}

export function isZhihuInput(input: string): boolean {
  return parseZhihuUrl(input) !== null;
}

export function canonicalZhihuUrl(input: string): string | null {
  const target = parseZhihuUrl(input);
  if (!target) return null;
  if (target.kind === "article") return `https://zhuanlan.zhihu.com/p/${target.id}`;
  if (target.kind === "answer" && target.questionId) {
    return `https://www.zhihu.com/question/${target.questionId}/answer/${target.id}`;
  }
  if (target.kind === "answer") return `https://www.zhihu.com/answer/${target.id}`;
  return `https://www.zhihu.com/question/${target.id}`;
}

export function cookiePair(cookie: string, name: string): string | null {
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0 || trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function zhihuHtmlToMarkdown(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<h([1-6])[^>]*>/gi, (_, level: string) => `\n${"#".repeat(Math.min(Number(level) + 1, 6))} `)
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(ul|ol|blockquote|figure)>/gi, "\n\n");
  const withLinks = withoutNoise.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
    const text = label.replace(/<[^>]+>/g, "").trim();
    return text ? `${text} (${href})` : href;
  });
  const stripped = withLinks.replace(/<[^>]+>/g, "");
  return decodeHtml(stripped).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}
