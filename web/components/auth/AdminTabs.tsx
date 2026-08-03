"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Settings2, Users } from "lucide-react";

interface AdminTabsProps {
  className?: string;
}

/** In-page navigation shared by every admin backend section. */
export function AdminTabs({ className = "" }: AdminTabsProps) {
  const { t } = useTranslation();
  const pathname = usePathname();

  const tabs = [
    {
      href: "/admin/users",
      label: t("User Management"),
      icon: Users,
      active: pathname.startsWith("/admin/users"),
    },
    {
      href: "/admin/defaults",
      label: t("Default Permissions"),
      icon: Settings2,
      active: pathname.startsWith("/admin/defaults"),
    },
  ];

  return (
    <div
      className={`flex w-fit items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 ${className}`}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
            tab.active
              ? "bg-[var(--foreground)] text-[var(--background)]"
              : "text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
          }`}
        >
          <tab.icon size={14} strokeWidth={1.8} />
          <span>{tab.label}</span>
        </Link>
      ))}
    </div>
  );
}
