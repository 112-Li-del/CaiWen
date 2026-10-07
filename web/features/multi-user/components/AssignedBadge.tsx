"use client";

import { useTranslation } from "react-i18next";

export function AssignedBadge({
  label,
}: {
  /** 不传时使用翻译后的默认文案「由管理员分配」。 */
  label?: string;
}) {
  const { t } = useTranslation();
  const text = label ?? t("Assigned by admin");
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
      {text}
    </span>
  );
}
