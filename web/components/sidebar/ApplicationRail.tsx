"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, ScanFace, UserRound, SlidersHorizontal, Settings, PanelLeft } from "lucide-react";

export const CAMPUS_MODULES = [
  { href: "/chat", label: "聊天", icon: MessageSquare },
  { href: "/portrait/overview", label: "查看画像", icon: ScanFace },
  { href: "/portrait/profile", label: "个人信息管理", icon: UserRound },
  { href: "/portrait/manage", label: "配置管理", icon: SlidersHorizontal },
];

export default function ApplicationRail({ onToggleSidebar, sidebarOpen }: {
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="应用导航" className="campus-rail flex h-dvh w-16 shrink-0 flex-col items-center border-r border-white/10 bg-[#10263f] py-4 text-slate-300">
      <Link href="/chat" aria-label="财问首页" className="mb-7 rounded-xl p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
        <Image src="/god.png" alt="财问" width={30} height={30} className="rounded-full" />
      </Link>
      <div className="flex w-full flex-col items-center gap-3">
        {CAMPUS_MODULES.map(({ href, label, icon: Icon }) => {
          const active = href === "/chat" ? pathname.startsWith("/chat") : pathname === href;
          return (
            <Link key={href} href={href} aria-label={label} aria-current={active ? "page" : undefined}
              className={`group relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${active ? "bg-white/15 text-white" : "hover:bg-white/10 hover:text-white"}`}>
              {active && <span className="absolute -left-2.5 h-5 w-[3px] rounded-full bg-[#e55b60]" />}
              <Icon size={20} strokeWidth={1.7} />
              <span className="pointer-events-none absolute left-full z-[80] ml-3 whitespace-nowrap rounded-lg bg-[var(--campus-rail)] px-3 py-2 text-xs text-white opacity-0 shadow-lg group-hover:opacity-100 group-focus-visible:opacity-100">{label}</span>
            </Link>
          );
        })}
      </div>
      <div className="mt-auto flex flex-col gap-3">
        {onToggleSidebar && <button type="button" onClick={onToggleSidebar} aria-label="切换聊天侧栏" aria-expanded={sidebarOpen} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white md:hidden"><PanelLeft size={20} /></button>}
        <Link href="/settings" aria-label="设置" title="设置" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"><Settings size={20} strokeWidth={1.7} /></Link>
      </div>
    </nav>
  );
}
