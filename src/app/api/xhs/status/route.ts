import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getXiaohongshuCookiePath } from "@/lib/storage";
import { xiaohongshuAccountName } from "@/lib/xiaohongshuLogin";

export async function GET(): Promise<NextResponse> {
  let cookie = "";
  try {
    cookie = (await fs.readFile(getXiaohongshuCookiePath(), "utf-8")).trim();
  } catch {
    cookie = "";
  }
  let nickname: string | null = null;
  if (cookie) {
    try {
      nickname = await xiaohongshuAccountName(cookie);
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
