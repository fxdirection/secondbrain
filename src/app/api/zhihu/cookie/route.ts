import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { writeZhihuCookie } from "@/lib/zhihuCapture";
import { getZhihuCookiePath } from "@/lib/storage";

function cleanCookie(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cookie = value.replace(/[\r\n]/g, "").trim();
  if (!cookie || cookie.length > 8192 || !cookie.includes("=")) return null;
  return cookie;
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const cookie = cleanCookie(body?.cookie);
    if (!cookie) {
      return NextResponse.json(
        { success: false, error: "Paste the Cookie header from a signed-in Zhihu browser session." },
        { status: 400 }
      );
    }
    await writeZhihuCookie(cookie);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "Failed to save the Zhihu cookie." }, { status: 500 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  await fs.unlink(getZhihuCookiePath()).catch(() => undefined);
  return NextResponse.json({ success: true });
}
