import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { zhihuLoginName } from "@/lib/zhihuCapture";
import { isZhihuLoginId, pollZhihuQrLogin, startZhihuQrLogin } from "@/lib/zhihuLogin";

export async function POST(): Promise<NextResponse> {
  try {
    const started = await startZhihuQrLogin();
    const image = await QRCode.toDataURL(started.url, {
      margin: 1,
      width: 196,
      errorCorrectionLevel: "M",
    });
    return NextResponse.json({ success: true, loginId: started.loginId, image });
  } catch {
    return NextResponse.json({ success: false, error: "Could not start Zhihu login." }, { status: 502 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const loginId = new URL(request.url).searchParams.get("id") || "";
  if (!isZhihuLoginId(loginId)) {
    return NextResponse.json({ success: false, error: "That login QR is no longer valid." }, { status: 400 });
  }
  try {
    const result = await pollZhihuQrLogin(loginId);
    if (result.state === "confirmed" && result.cookie) {
      const nickname = await zhihuLoginName(result.cookie);
      return NextResponse.json({ success: true, state: "confirmed", nickname });
    }
    return NextResponse.json({
      success: true,
      state: result.state,
      verifyUrl: result.verifyUrl,
    });
  } catch {
    return NextResponse.json({ success: false, error: "Could not check the Zhihu login." }, { status: 502 });
  }
}
