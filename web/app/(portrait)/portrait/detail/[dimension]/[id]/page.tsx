
import { notFound } from "next/navigation";
import Link from "next/link";
import PortraitDetailClient from "@/features/portrait/PortraitDetailClient";

type PageProps = {
  params: Promise<{
    dimension: string;
    id: string;
  }>;
};

export default async function PortraitDetailPage({
  params,
}: PageProps) {
  const { dimension, id } = await params;

  // 只允许学生详情和班级详情
  if (dimension !== "student" && dimension !== "class") {
    notFound();
  }

  // ID 必须是正整数
  const numericId = Number(id);

  if (
    !Number.isSafeInteger(numericId) ||
    numericId <= 0
  ) {
    notFound();
  }

  const title =
    dimension === "student" ? "学生画像详情" : "班级画像详情";

  return (
    <main className="mx-auto min-h-full max-w-6xl px-6 py-8 sm:px-10">
      <div className="mb-6">
        <Link
          href="/portrait/overview"
          className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          ← 返回画像概览
        </Link>
      </div>

      <header className="mb-8 border-b border-[var(--border)] pb-6">
        <p className="text-sm text-[var(--muted-foreground)]">
          学生画像 / 详情分析
        </p>

        <h1 className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
          {title}
        </h1>

        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          {dimension === "student" ? "学生 ID" : "班级 ID"}：{numericId}
        </p>
      </header>

      <PortraitDetailClient
        dimension={dimension}
        id={numericId}
      />
    </main>
  );
}
