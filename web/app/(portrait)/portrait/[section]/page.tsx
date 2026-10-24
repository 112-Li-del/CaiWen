import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, ScanFace } from "lucide-react";
import PortraitOverview from "@/features/portrait/PortraitOverview";

const sections: Record<string, { title: string; subtitle: string; description: string; items: string[] }> = {
  overview: { title: "查看画像", subtitle: "学生画像", description: "在这里了解学习表现、能力特征与成长变化。", items: ["学生与班级画像", "学习表现与能力分析", "个性化学业建议"] },
  profile: { title: "个人信息管理", subtitle: "学生档案", description: "让基础信息、在校信息与学习档案汇聚在一起。", items: ["基础信息", "学院、专业与班级", "在校与学习档案"] },
  manage: { title: "配置管理", subtitle: "画像管理", description: "集中管理画像所需的数据与标签规则。", items: ["数据导入与校验", "标签规则与计算任务"] },
};

export default async function PortraitSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === "overview") return <PortraitOverview />;
  const content = Object.hasOwn(sections, section) ? sections[section] : undefined;
  if (!content) notFound();
  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-6 py-7 sm:px-12 sm:py-10">
      <header className="flex items-center justify-between border-b border-[var(--border)] pb-6">
        <span className="text-sm font-semibold text-[var(--foreground)]">财问 <span className="mx-3 font-normal text-[var(--muted-foreground)]">/</span> {content.title}</span>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted-foreground)]">功能筹备中</span>
      </header>
      <section className="my-auto py-16 sm:py-24">
        <div className="mb-7 flex items-center gap-3 text-sm text-[var(--muted-foreground)]"><ScanFace size={22} strokeWidth={1.5} /><span>{content.subtitle}</span></div>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">{content.title}</h1>
        <p className="mt-5 max-w-xl text-base leading-8 text-[var(--muted-foreground)]">{content.description}</p>
        <div className="mt-10 max-w-2xl border-y border-[var(--border)] py-2">
          {content.items.map((item, index) => <div key={item} className="flex items-center gap-6 border-b border-[var(--border)] py-5 last:border-0"><span className="font-mono text-xs text-[var(--muted-foreground)]">0{index + 1}</span><span className="text-sm text-[var(--foreground)]">{item}</span><span className="ml-auto text-xs text-[var(--muted-foreground)]">待接入</span></div>)}
        </div>
        <p className="mt-5 text-xs leading-6 text-[var(--muted-foreground)]">当前仅展示模块入口，尚未接入学生数据或开通管理操作。</p>
        <Link href="/chat" className="mt-9 inline-flex items-center gap-3 rounded-lg bg-[#173658] px-5 py-3 text-sm text-white transition-colors hover:bg-[#24486f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#173658]">返回财问聊天 <ArrowUpRight size={16} /></Link>
      </section>
      <footer className="text-xs text-[var(--muted-foreground)]">南京财经大学 · 财问</footer>
    </div>
  );
}
