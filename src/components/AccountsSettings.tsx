"use client";

import React from "react";
import { theme } from "@/lib/theme";
import { t } from "@/lib/i18n";
import { VideoSettings } from "@/components/VideoSettings";
import { ZhihuSettings } from "@/components/ZhihuSettings";
import { XiaohongshuSettings } from "@/components/XiaohongshuSettings";

const PLATFORMS = [
  { name: "YouTube", detail: "accounts.youtube" },
  { name: "抖音", detail: "accounts.douyin" },
] as const;

export function AccountsSettings({ palette }: { palette: Record<number, string> }) {
  return (
    <div>
      <p className="text-xs mb-6" style={{ color: theme.textMuted }}>
        {t("accounts.intro")}
      </p>
      <VideoSettings palette={palette} embedded />
      <ZhihuSettings palette={palette} />
      <XiaohongshuSettings palette={palette} />
      {PLATFORMS.map((platform) => (
        <div key={platform.name} className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
          <div className="text-sm font-medium">{platform.name}</div>
          <p className="text-xs mt-1" style={{ color: theme.textMuted }}>{t(platform.detail)}</p>
        </div>
      ))}
    </div>
  );
}
