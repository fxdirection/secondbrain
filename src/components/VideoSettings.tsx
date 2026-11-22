"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { theme } from "@/lib/theme";
import { t } from "@/lib/i18n";

interface VideoStatus {
  cookieSaved: boolean;
  nickname: string | null;
  whisperAvailable: boolean | null;
  whisperDetail: string;
  whisperModel: string;
  whisperLanguage: string;
  deleteAudioAfter: boolean;
}

export function VideoSettings({ palette, embedded = false }: { palette: Record<number, string>; embedded?: boolean }) {
  const [status, setStatus] = useState<VideoStatus | null>(null);
  const [cookie, setCookie] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ key: string; image: string } | null>(null);
  const [scanState, setScanState] = useState("");
  const qrRef = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async (includeWhisper = false) => {
    const res = await fetch(includeWhisper ? "/api/video/status?whisper=1" : "/api/video/status");
    const data = await res.json();
    if (data.success) {
      setStatus((current) => ({
        cookieSaved: data.cookieSaved,
        nickname: data.nickname,
        whisperAvailable: data.whisperAvailable ?? current?.whisperAvailable ?? null,
        whisperDetail: data.whisperDetail || current?.whisperDetail || "",
        whisperModel: data.whisperModel,
        whisperLanguage: data.whisperLanguage,
        deleteAudioAfter: data.deleteAudioAfter,
      }));
    }
  }, []);

  useEffect(() => {
    loadStatus()
      .then(() => loadStatus(true))
      .catch(() => setMessage("Could not check video tools."));
  }, [loadStatus]);

  useEffect(() => {
    if (!qr) return;
    qrRef.current?.scrollIntoView({ block: "nearest" });
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/video/login?key=${encodeURIComponent(qr.key)}`);
        const data = await res.json();
        if (stopped) return;
        if (!data.success) {
          setQr(null);
          setMessage(data.error || "Could not check the Bilibili login.");
          return;
        }
        if (data.state === "scanned") {
          setScanState("Confirm the login on your phone.");
          return;
        }
        if (data.state === "confirmed") {
          setQr(null);
          setMessage(data.nickname ? `Signed in as ${data.nickname}.` : "Signed in.");
          await loadStatus();
          return;
        }
        if (data.state === "expired") {
          setQr(null);
          setMessage("The QR code expired. Click Sign in to make a new one.");
        }
      } catch {
        if (!stopped) setMessage("Could not check the Bilibili login.");
      }
    };
    const timer = setInterval(() => void tick(), 2000);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [qr, loadStatus]);

  const startLogin = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/video/login", { method: "POST" });
      const data = await res.json();
      if (!data.success || !data.image || !data.qrcodeKey) {
        throw new Error(data.error || "Could not start Bilibili login.");
      }
      setQr({ key: data.qrcodeKey, image: data.image });
      setScanState("Open the Bilibili app and scan this code.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start Bilibili login.");
    } finally {
      setBusy(false);
    }
  };

  const saveCookie = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/video/cookie", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to save the cookie.");
      setCookie("");
      setMessage("Cookie saved on this computer.");
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save the cookie.");
    } finally {
      setBusy(false);
    }
  };

  const removeCookie = async () => {
    setBusy(true);
    setMessage("");
    try {
      await fetch("/api/video/cookie", { method: "DELETE" });
      setMessage("Bilibili cookie removed.");
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const saveDeleteAudio = async (deleteAudioAfter: boolean) => {
    if (!status) return;
    setStatus({ ...status, deleteAudioAfter });
    await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video: {
          whisperModel: status.whisperModel,
          whisperLanguage: status.whisperLanguage,
          deleteAudioAfter,
        },
      }),
    });
  };

  const loginText = !status
    ? "Checking"
    : status.nickname
      ? `Signed in as ${status.nickname}`
      : status.cookieSaved
        ? "Cookie saved, but Bilibili did not accept it."
        : "Not signed in";

  return (
    <div className={embedded ? "" : "mt-8 pt-5 border-t"} style={{ borderColor: theme.border }}>
      <label className="block text-sm font-medium mb-1">{embedded ? t("accounts.bilibili") : "Video"}</label>
      <p className="text-xs mb-4" style={{ color: theme.textMuted }}>
        Bilibili links are captured as a transcript. Sign in once with the Bilibili app. Official subtitles are used first.
      </p>

      <div className="mb-4">
        <div className="text-sm mb-2">{loginText}</div>
        {qr ? (
          <div ref={qrRef} className="mb-3">
            <img
              src={qr.image}
              alt="Bilibili login QR code"
              width={196}
              height={196}
              className="rounded-lg border bg-white"
              style={{ borderColor: theme.border }}
            />
            <p className="text-xs mt-2" style={{ color: theme.textMuted }}>{scanState}</p>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startLogin}
              disabled={busy || !status}
              className="px-3 py-2 rounded-lg text-white text-sm disabled:opacity-50"
              style={{ backgroundColor: palette[500] }}
            >
              {!status ? "Checking" : status.cookieSaved ? "Sign in again" : "Sign in"}
            </button>
            {status?.cookieSaved && (
              <button
                type="button"
                onClick={removeCookie}
                disabled={busy}
                className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50"
                style={{ borderColor: theme.border, color: theme.textMuted }}
              >
                Remove
              </button>
            )}
          </div>
        )}
        <details className="mt-3">
          <summary className="text-xs cursor-pointer" style={{ color: theme.textMuted }}>
            Paste a cookie instead
          </summary>
          <textarea
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            placeholder="Paste the Cookie header from your browser"
            rows={3}
            className="w-full px-3 py-2 text-sm border rounded-lg mt-2"
            style={{ borderColor: theme.border }}
          />
          <button
            type="button"
            onClick={saveCookie}
            disabled={busy || !cookie.trim()}
            className="mt-2 px-3 py-2 rounded-lg border text-sm disabled:opacity-50"
            style={{ borderColor: theme.border, color: theme.textMuted }}
          >
            Update cookie
          </button>
          <p className="text-xs mt-2" style={{ color: theme.textMuted }}>
            The cookie stays in user_data/bilibili.cookies.txt on this computer. It is not written onto the card.
          </p>
        </details>
      </div>

      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm">faster-whisper {status?.whisperModel || "large-v3"} · CUDA · {status?.whisperLanguage === "zh" ? "Chinese" : status?.whisperLanguage || "Chinese"}</div>
          <p className="text-xs mt-1" style={{ color: status?.whisperAvailable ? palette[600] : theme.textMuted }}>
            {status?.whisperDetail || "Checking local transcription..."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadStatus(true).catch(() => setMessage("Could not check video tools."))}
          className="px-3 py-2 rounded-lg border text-sm"
          style={{ borderColor: theme.border, color: theme.textMuted }}
        >
          Check
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={status?.deleteAudioAfter !== false}
          onChange={(event) => saveDeleteAudio(event.target.checked)}
        />
        Delete audio after transcription
      </label>
      {message && <p className="text-xs mt-3" style={{ color: palette[600] }}>{message}</p>}
    </div>
  );
}
