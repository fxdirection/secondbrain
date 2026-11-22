import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { isXhsLoginId, pollXhsQrLogin, startXhsQrLogin, xiaohongshuAccountName } from "@/lib/xiaohongshuLogin";

export async function POST(): Promise<NextResponse> {
  try {
    const started = await startXhsQrLogin();
    const image = await QRCode.toDataURL(started.url, {
      margin: 1,
      width: 196,
      errorCorrectionLevel: "M",
    });
    return NextResponse.json({ success: true, loginId: started.loginId, image });
  } catch {
    return NextResponse.json({ success: false, error: "Could not start Xiaohongshu login." }, { status: 502 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const loginId = new URL(request.url).searchParams.get("id") || "";
  if (!isXhsLoginId(loginId)) {
    return NextResponse.json({ success: false, error: "That login QR is no longer valid." }, { status: 400 });
  }
  try {
    const result = await pollXhsQrLogin(loginId);
    if (result.state === "confirmed" && result.cookie) {
      const nickname = await xiaohongshuAccountName(result.cookie);
      return NextResponse.json({ success: true, state: "confirmed", nickname });
    }
    return NextResponse.json({ success: true, state: result.state });
  } catch {
    return NextResponse.json({ success: false, error: "Could not check the Xiaohongshu login." }, { status: 502 });
  }
}
