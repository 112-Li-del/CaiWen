import WorkspaceSidebar from "@/components/sidebar/WorkspaceSidebar";
import { UnifiedChatProvider } from "@/context/UnifiedChatContext";

export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <UnifiedChatProvider>
      <div className="flex h-dvh overflow-hidden">
        <WorkspaceSidebar />
        <main className="min-w-0 flex-1 overflow-hidden bg-[var(--background)]">
          {children}
        </main>
      </div>
    </UnifiedChatProvider>
  );
}
