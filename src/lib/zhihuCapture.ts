import path from "path";
import { promises as fs } from "fs";
import {
  ZHIHU_LOGIN_REJECTED,
  ZHIHU_LOGIN_REQUIRED,
  ZhihuTarget,
  canonicalZhihuUrl,
  cookiePair,
  parseZhihuUrl,
  zhihuHtmlToMarkdown,
} from "./zhihu";
import { guestDc0, signZhihuRequest } from "./zhihuSign";
import { getZhihuCookiePath, updatePendingTitle } from "./storage";

const ZHIHU_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

type FetchLike = typeof fetch;

interface ZhihuAuthor {
  name?: string;
}

interface ZhihuPayload {
  title?: string;
  content?: string;
  detail?: string;
  excerpt?: string;
  author?: ZhihuAuthor;
  question?: { title?: string };
  name?: string;
  error?: { message?: string; code?: number };
  data?: ZhihuPayload[];
}

async function readCookie(): Promise<string | null> {
  try {
    const text = (await fs.readFile(getZhihuCookiePath(), "utf-8")).trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function writeZhihuCookie(cookie: string): Promise<void> {
  const cookiePath = getZhihuCookiePath();
  await fs.mkdir(path.dirname(cookiePath), { recursive: true });
  await fs.writeFile(cookiePath, `${cookie}\n`, { encoding: "utf-8", mode: 0o600 });
}

function needsLogin(payload: ZhihuPayload): boolean {
  const message = payload.error?.message || "";
  return /登录|login/i.test(message);
}

async function zhihuJson(url: string, cookie: string | null, fetchImpl: FetchLike): Promise<ZhihuPayload> {
  const savedDc0 = cookie ? cookiePair(cookie, "d_c0") : null;
  const dc0 = savedDc0 || guestDc0();
  const headerCookie = savedDc0 ? cookie! : `${cookie ? `${cookie}; ` : ""}d_c0=${dc0}`;
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": ZHIHU_USER_AGENT,
      Referer: "https://www.zhihu.com/",
      Accept: "application/json",
      Cookie: headerCookie,
      ...signZhihuRequest(url, dc0),
    },
  });
  return response.json() as Promise<ZhihuPayload>;
}

function bodyFromPayload(payload: ZhihuPayload): string {
  return zhihuHtmlToMarkdown(payload.content || payload.detail || payload.excerpt || "");
}

function answerMarkdown(payload: ZhihuPayload): string {
  const author = payload.author?.name ? `作者：${payload.author.name}` : "";
  const body = bodyFromPayload(payload);
  return [author, body].filter(Boolean).join("\n\n");
}

async function loadTarget(target: ZhihuTarget, cookie: string | null, fetchImpl: FetchLike): Promise<{ title: string; markdown: string }> {
  if (target.kind === "article") {
    const payload = await zhihuJson(`https://www.zhihu.com/api/v4/articles/${target.id}`, cookie, fetchImpl);
    if (needsLogin(payload)) throw new Error(cookie ? ZHIHU_LOGIN_REJECTED : ZHIHU_LOGIN_REQUIRED);
    const markdown = bodyFromPayload(payload);
    if (!payload.title || !markdown) throw new Error(payload.error?.message || "Zhihu did not return this article.");
    const author = payload.author?.name ? `作者：${payload.author.name}\n\n` : "";
    return { title: payload.title, markdown: `${author}${markdown}` };
  }

  if (target.kind === "answer") {
    const payload = await zhihuJson(
      `https://www.zhihu.com/api/v4/answers/${target.id}?include=content,excerpt,author,question`,
      cookie,
      fetchImpl
    );
    if (needsLogin(payload)) throw new Error(cookie ? ZHIHU_LOGIN_REJECTED : ZHIHU_LOGIN_REQUIRED);
    const title = payload.question?.title || payload.author?.name || target.id;
    const markdown = answerMarkdown(payload);
    if (!markdown) throw new Error(payload.error?.message || "Zhihu did not return this answer.");
    const heading = payload.author?.name && payload.question?.title
      ? `${payload.question.title} - ${payload.author.name} 的回答`
      : title;
    return { title: heading, markdown };
  }

  const question = await zhihuJson(
    `https://www.zhihu.com/api/v4/questions/${target.id}?include=detail,excerpt,title`,
    cookie,
    fetchImpl
  );
  if (needsLogin(question)) throw new Error(cookie ? ZHIHU_LOGIN_REJECTED : ZHIHU_LOGIN_REQUIRED);
  const markdown = bodyFromPayload(question);
  if (!question.title || !markdown) throw new Error(question.error?.message || "Zhihu did not return this question.");
  return { title: question.title, markdown };
}

export async function captureZhihuPost(
  id: string,
  input: string,
  fetchImpl: FetchLike = fetch
): Promise<{ title: string; markdown: string; url: string }> {
  const target = parseZhihuUrl(input);
  if (!target) throw new Error("This Zhihu link does not point at a post.");
  const cookie = await readCookie();
  let loaded: { title: string; markdown: string };
  try {
    loaded = await loadTarget(target, null, fetchImpl);
  } catch (error) {
    if (!cookie || !(error instanceof Error) || error.message !== ZHIHU_LOGIN_REQUIRED) throw error;
    loaded = await loadTarget(target, cookie, fetchImpl);
  }
  await updatePendingTitle(id, loaded.title).catch(() => undefined);
  return {
    title: loaded.title,
    markdown: loaded.markdown,
    url: canonicalZhihuUrl(input) || input,
  };
}

export async function zhihuLoginName(cookie: string): Promise<string | null> {
  const dc0 = cookiePair(cookie, "d_c0");
  if (!dc0 || !cookiePair(cookie, "z_c0")) return null;
  const payload = await zhihuJson("https://www.zhihu.com/api/v4/me", cookie, fetch);
  return payload.name || null;
}
