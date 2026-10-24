"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import { AdminTabs } from "@/components/auth/AdminTabs";
import { DefaultGrantsEditor } from "@/features/multi-user/components/DefaultGrantsEditor";
import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";

export default function AdminDefaultsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (!status?.authenticated) {
        router.replace("/login");
        return;
      }
      if (status.role !== "admin") {
        router.replace("/");
        return;
      }
      setReady(true);
    });
  }, [router]);

  if (!ready) {
    return (
      <div className="h-screen bg-[var(--background)] px-4 py-10">
        <div className="mx-auto max-w-3xl" />
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeft size={15} />
            {t("Back")}
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-[var(--foreground)]">
              {t("默认权限")}
            </h1>
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
              {t(
                "统一设置所有普通成员可使用的模型与公共知识库。",
              )}
            </p>
          </div>
        </div>

        <AdminTabs className="mb-5" />

        <DefaultGrantsEditor />

        <div className="mt-8 flex items-center justify-center gap-2 text-center text-xs text-[var(--muted-foreground)]">
          <RefreshCw size={11} strokeWidth={1.6} />
          {t("保存后对所有普通成员生效，已打开的页面请刷新。")}
        </div>
      </div>
    </div>
  );
}
