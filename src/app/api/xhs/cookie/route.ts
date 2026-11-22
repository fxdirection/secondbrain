import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { writeXiaohongshuCookie } from "@/lib/xiaohongshuCapture";
import { getXiaohongshuCookiePath } from "@/lib/storage";

function cleanCookie(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cookie = value.replace(/[\r\n]/g, "").trim();
  if (!cookie || cookie.length > 16384 || !cookie.includes("=")) return null;
  return cookie;
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const cookie = cleanCookie(body?.cookie);
    if (!cookie) {
      return NextResponse.json(
        { success: false, error: "Paste the Cookie header from a signed-in Xiaohongshu page." },
        { status: 400 }
      );
    }
    await writeXiaohongshuCookie(cookie);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "Failed to save the Xiaohongshu cookie." }, { status: 500 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  await fs.unlink(getXiaohongshuCookiePath()).catch(() => undefined);
  return NextResponse.json({ success: true });
}
