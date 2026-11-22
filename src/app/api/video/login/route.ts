import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { bilibiliLoginName } from "@/lib/videoCapture";
import { isQrcodeKey, pollQrLogin, startQrLogin, writeBilibiliCookie } from "@/lib/bilibiliLogin";

export async function POST(): Promise<NextResponse> {
  try {
    const started = await startQrLogin();
    const image = await QRCode.toDataURL(started.url, {
      margin: 1,
      width: 196,
      errorCorrectionLevel: "M",
    });
    return NextResponse.json({ success: true, qrcodeKey: started.qrcodeKey, image });
  } catch {
    return NextResponse.json({ success: false, error: "Could not start Bilibili login." }, { status: 502 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!isQrcodeKey(key)) {
    return NextResponse.json({ success: false, error: "That login QR is no longer valid." }, { status: 400 });
  }
  try {
    const result = await pollQrLogin(key);
    if (result.state === "confirmed" && result.cookie) {
      await writeBilibiliCookie(result.cookie);
      const nickname = await bilibiliLoginName(result.cookie);
      return NextResponse.json({ success: true, state: "confirmed", nickname });
    }
    return NextResponse.json({ success: true, state: result.state });
  } catch {
    return NextResponse.json({ success: false, error: "Could not check the Bilibili login." }, { status: 502 });
  }
}
