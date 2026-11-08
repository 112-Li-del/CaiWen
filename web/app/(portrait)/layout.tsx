import ApplicationRail from "@/components/sidebar/ApplicationRail";
import { PortraitSelectionProvider } from "@/features/portrait/PortraitSelection";

export default function PortraitLayout({ children }: { children: React.ReactNode }) {
  return <PortraitSelectionProvider><div className="flex h-dvh overflow-hidden"><ApplicationRail /><main className="min-w-0 flex-1 overflow-y-auto bg-[var(--background)]">{children}</main></div></PortraitSelectionProvider>;
}
