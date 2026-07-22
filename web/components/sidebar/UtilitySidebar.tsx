"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { SidebarShell } from "@/components/sidebar/SidebarShell";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { AdminLink } from "@/components/auth/AdminLink";
import { useAppShell } from "@/context/AppShellContext";
import { fetchAuthStatus, AUTH_ENABLED } from "@/lib/auth";
import {
  deleteSession,
  listSessions,
  updateSessionTitle,
  type SessionSummary,
} from "@/lib/session-api";

export default function UtilitySidebar() {
  const { t } = useTranslation();
  const router = useRouter();
  const { activeSessionId, setActiveSessionId } = useAppShell();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const hasLoadedSessionsRef = useRef(false);

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    fetchAuthStatus().then((status) => {
      setIsAdmin(status?.role === "admin");
    });
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!hasLoadedSessionsRef.current) {
      setLoadingSessions(true);
    }
    try {
      setSessions(await listSessions(50, 0, { force: true }));
      hasLoadedSessionsRef.current = true;
    } catch (error) {
      console.error("Failed to load sessions", error);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const handleNewChat = useCallback(() => {
    setActiveSessionId(null);
    router.push("/chat");
  }, [router, setActiveSessionId]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      setActiveSessionId(sessionId);
      router.push(`/chat/${sessionId}`);
    },
    [router, setActiveSessionId],
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, title: string) => {
      const updated = await updateSessionTitle(sessionId, title);
      setSessions((prev) =>
        prev.map((session) =>
          session.session_id === sessionId
            ? {
                ...session,
                title: updated.title,
                updated_at: updated.updated_at,
              }
            : session,
        ),
      );
    },
    [],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!window.confirm(t("Delete this chat history?"))) return;
      await deleteSession(sessionId);
      setSessions((prev) =>
        prev.filter((session) => session.session_id !== sessionId),
      );
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
    },
    [activeSessionId, setActiveSessionId],
  );

  return (
    <SidebarShell
      showSessions
      sessions={sessions}
      activeSessionId={activeSessionId}
      loadingSessions={loadingSessions}
      onNewChat={handleNewChat}
      onSelectSession={handleSelectSession}
      onRenameSession={handleRenameSession}
      onDeleteSession={handleDeleteSession}
      isAdmin={isAdmin}
      footerSlot={
        <>
          <AdminLink />
          <LogoutButton />
        </>
      }
    />
  );
}
