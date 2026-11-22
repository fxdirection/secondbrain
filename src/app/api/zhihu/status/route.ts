import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getZhihuCookiePath } from "@/lib/storage";
import { zhihuLoginName } from "@/lib/zhihuCapture";

export async function GET(): Promise<NextResponse> {
  let cookie = "";
  try {
    cookie = (await fs.readFile(getZhihuCookiePath(), "utf-8")).trim();
  } catch {
    cookie = "";
  }
  let nickname: string | null = null;
  if (cookie) {
    try {
      nickname = await zhihuLoginName(cookie);
    } catch {
      nickname = null;
    }
  }
  return NextResponse.json({
    success: true,
    cookieSaved: Boolean(cookie),
    nickname,
  });
}
