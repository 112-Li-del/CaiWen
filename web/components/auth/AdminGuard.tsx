"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchAuthStatus, AUTH_ENABLED } from "@/lib/auth";

interface AdminGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Wraps content that should only be accessible to admin users.
 * When auth is disabled, all content is allowed through.
 * When auth is enabled, non-admin users are redirected to /chat.
 */
export function AdminGuard({ children, fallback }: AdminGuardProps) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(!AUTH_ENABLED);

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    fetchAuthStatus().then((status) => {
      if (status?.role !== "admin") {
        router.replace("/chat");
      } else {
        setAllowed(true);
      }
    });
  }, [router]);

  if (!allowed) {
    return <>{fallback ?? null}</>;
  }

  return <>{children}</>;
}
