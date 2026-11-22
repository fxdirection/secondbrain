"use client";

import React, { useCallback, useEffect, useState } from "react";
import { theme } from "@/lib/theme";
import { t } from "@/lib/i18n";

export function XiaohongshuSettings({ palette }: { palette: Record<number, string> }) {
  const [cookie, setCookie] = useState("");
  const [cookieSaved, setCookieSaved] = useState(false);
  const [nickname, setNickname] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/xhs/status");
    const data = await res.json();
    if (!data.success) return;
    setCookieSaved(Boolean(data.cookieSaved));
    setNickname(data.nickname || null);
    setReady(true);
  }, []);

  useEffect(() => {
    loadStatus().catch(() => setMessage(t("accounts.xhsStatusFailed")));
  }, [loadStatus]);

  const saveCookie = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/xhs/cookie", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || t("accounts.xhsSaveFailed"));
      setCookie("");
      setMessage(t("accounts.xhsSaved"));
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("accounts.xhsSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const removeCookie = async () => {
    setBusy(true);
    setMessage("");
    try {
      await fetch("/api/xhs/cookie", { method: "DELETE" });
      setMessage(t("accounts.xhsRemoved"));
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const loginText = !ready
    ? t("header.checking")
    : nickname
      ? t("accounts.xhsSignedIn", { name: nickname })
      : cookieSaved
        ? t("accounts.xhsRejected")
        : t("accounts.xhsSignedOut");

  return (
    <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
      <div className="text-sm font-medium mb-1">{t("accounts.xhsName")}</div>
      <p className="text-xs mb-3" style={{ color: theme.textMuted }}>{t("accounts.xiaohongshu")}</p>
      <div className="text-sm mb-2">{loginText}</div>
      <textarea
        value={cookie}
        onChange={(event) => setCookie(event.target.value)}
        placeholder={t("accounts.xhsPlaceholder")}
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
          {t("accounts.xhsUpdate")}
        </button>
        {cookieSaved && (
          <button
            type="button"
            onClick={removeCookie}
            disabled={busy}
            className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50"
            style={{ borderColor: theme.border, color: theme.textMuted }}
          >
            {t("accounts.xhsRemove")}
          </button>
        )}
      </div>
      <p className="text-xs mt-2" style={{ color: theme.textMuted }}>{t("accounts.xhsPath")}</p>
      {message && <p className="text-xs mt-2" style={{ color: palette[600] }}>{message}</p>}
    </div>
  );
}
