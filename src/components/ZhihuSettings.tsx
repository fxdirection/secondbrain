"use client";

import React, { useCallback, useEffect, useState } from "react";
import { theme } from "@/lib/theme";
import { t } from "@/lib/i18n";

export function ZhihuSettings({ palette }: { palette: Record<number, string> }) {
  const [cookie, setCookie] = useState("");
  const [cookieSaved, setCookieSaved] = useState(false);
  const [nickname, setNickname] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [qr, setQr] = useState<{ id: string; image: string } | null>(null);
  const [scanState, setScanState] = useState("");
  const [verifyUrl, setVerifyUrl] = useState("");

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/zhihu/status");
    const data = await res.json();
    if (!data.success) return;
    setCookieSaved(Boolean(data.cookieSaved));
    setNickname(data.nickname || null);
    setReady(true);
  }, []);

  useEffect(() => {
    loadStatus().catch(() => setMessage(t("accounts.zhihuStatusFailed")));
  }, [loadStatus]);

  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/zhihu/login?id=${encodeURIComponent(qr.id)}`);
        const data = await res.json();
        if (stopped) return;
        if (!data.success) {
          setQr(null);
          setMessage(data.error || t("accounts.zhihuStatusFailed"));
          return;
        }
        if (data.state === "scanned") {
          setScanState(t("accounts.zhihuScanned"));
          setVerifyUrl("");
          return;
        }
        if (data.state === "blocked") {
          setScanState(t("accounts.zhihuBlocked"));
          setVerifyUrl(typeof data.verifyUrl === "string" ? data.verifyUrl : "");
          return;
        }
        if (data.state === "confirmed") {
          setQr(null);
          setVerifyUrl("");
          setMessage(data.nickname ? t("accounts.zhihuSignedIn", { name: data.nickname }) : t("accounts.zhihuSaved"));
          await loadStatus();
          return;
        }
        if (data.state === "expired") {
          setQr(null);
          setVerifyUrl("");
          setMessage(t("accounts.zhihuExpired"));
        }
      } catch {
        if (!stopped) setMessage(t("accounts.zhihuStatusFailed"));
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
    setVerifyUrl("");
    try {
      const res = await fetch("/api/zhihu/login", { method: "POST" });
      const data = await res.json();
      if (!data.success || !data.image || !data.loginId) throw new Error(data.error || t("accounts.zhihuScanFailed"));
      setQr({ id: data.loginId, image: data.image });
      setScanState(t("accounts.zhihuScanHint"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("accounts.zhihuScanFailed"));
    } finally {
      setBusy(false);
    }
  };

  const saveCookie = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/zhihu/cookie", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || t("accounts.zhihuSaveFailed"));
      setCookie("");
      setMessage(t("accounts.zhihuSaved"));
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("accounts.zhihuSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const removeCookie = async () => {
    setBusy(true);
    setMessage("");
    try {
      await fetch("/api/zhihu/cookie", { method: "DELETE" });
      setMessage(t("accounts.zhihuRemoved"));
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const loginText = !ready
    ? t("header.checking")
    : nickname
      ? t("accounts.zhihuSignedIn", { name: nickname })
      : cookieSaved
        ? t("accounts.zhihuRejected")
        : t("accounts.zhihuSignedOut");

  return (
    <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
      <div className="text-sm font-medium mb-1">{t("accounts.zhihuName")}</div>
      <p className="text-xs mb-3" style={{ color: theme.textMuted }}>{t("accounts.zhihu")}</p>
      <div className="text-sm mb-2">{loginText}</div>
      {qr ? (
        <div className="mb-3">
          <img
            src={qr.image}
            alt={t("accounts.zhihuScan")}
            width={196}
            height={196}
            className="rounded-lg border bg-white"
            style={{ borderColor: theme.border }}
          />
          <p className="text-xs mt-2" style={{ color: theme.textMuted }}>{scanState}</p>
          {verifyUrl && (
            <a className="text-xs underline" href={verifyUrl} target="_blank" rel="noreferrer">
              {t("accounts.zhihuVerify")}
            </a>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={startLogin}
          disabled={busy || !ready}
          className="px-3 py-2 rounded-lg text-white text-sm disabled:opacity-50"
          style={{ backgroundColor: palette[500] }}
        >
          {t("accounts.zhihuScan")}
        </button>
      )}
      <details className="mt-3">
        <summary className="text-xs cursor-pointer" style={{ color: theme.textMuted }}>{t("accounts.zhihuPaste")}</summary>
        <textarea
        value={cookie}
        onChange={(event) => setCookie(event.target.value)}
        placeholder={t("accounts.zhihuPlaceholder")}
        rows={3}
        className="w-full px-3 py-2 text-sm border rounded-lg"
        style={{ borderColor: theme.border }}
      />
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={saveCookie}
          disabled={busy || !cookie.trim()}
          className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50"
          style={{ borderColor: theme.border, color: theme.textMuted }}
        >
          {t("accounts.zhihuUpdate")}
        </button>
        {cookieSaved && (
          <button
            type="button"
            onClick={removeCookie}
            disabled={busy}
            className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50"
            style={{ borderColor: theme.border, color: theme.textMuted }}
          >
            {t("accounts.zhihuRemove")}
          </button>
        )}
      </div>
      <p className="text-xs mt-2" style={{ color: theme.textMuted }}>{t("accounts.zhihuPath")}</p>
      </details>
      {message && <p className="text-xs mt-2" style={{ color: palette[600] }}>{message}</p>}
    </div>
  );
}
