import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { cleanBilibiliCookie, writeBilibiliCookie } from "@/lib/bilibiliLogin";
import { getBilibiliCookiePath } from "@/lib/storage";

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const cookie = cleanBilibiliCookie(body?.cookie);
    if (!cookie) {
      return NextResponse.json(
        { success: false, error: "Paste the Cookie header from a signed-in Bilibili browser session." },
        { status: 400 }
      );
    }
    await writeBilibiliCookie(cookie);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "Failed to save the Bilibili cookie." }, { status: 500 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  await fs.unlink(getBilibiliCookiePath()).catch(() => undefined);
  return NextResponse.json({ success: true });
}
