import { NextRequest, NextResponse } from "next/server";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
const LOGIN_PATH = "/login";
const COOKIE_NAME = "dt_token";

// Pages that require admin role
const ADMIN_ROUTES = ["/admin", "/knowledge", "/space", "/co-writer", "/book"];

// Static asset extensions that don't need auth
const STATIC_EXT = /\.(jpg|jpeg|png|gif|svg|webp|ico|woff2?|ttf|eot|css|js|json|map|txt)$/i;

function isStaticAsset(pathname: string): boolean {
  return STATIC_EXT.test(pathname);
}

function isAdminRoute(pathname: string): boolean {
  return ADMIN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/agents" || pathname.startsWith("/agents/")) {
    return NextResponse.redirect(new URL("/chat", req.url));
  }

  // Auth is disabled (default) — let everything through
  if (!AUTH_ENABLED) return NextResponse.next();

  // Always allow auth pages, Next.js internals, and static assets
  if (
    pathname.startsWith(LOGIN_PATH) ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    isStaticAsset(pathname)
  ) {
    return NextResponse.next();
  }

  const session = req.cookies.get(COOKIE_NAME)?.value;
  const toLogin = () => {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  };
  if (!session?.startsWith("cws_")) return toLogin();

  if (isAdminRoute(pathname)) {
    try {
      const backend = process.env.AUTH_INTERNAL_API_BASE ||
        `http://127.0.0.1:${process.env.BACKEND_PORT || "8001"}`;
      const response = await fetch(`${backend.replace(/\/$/, "")}/api/v1/auth/status`, {
        headers: { Cookie: `${COOKIE_NAME}=${encodeURIComponent(session)}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return toLogin();
      const status = await response.json();
      if (!status.authenticated) return toLogin();
      if (!status.is_admin) {
        const chatUrl = req.nextUrl.clone();
        chatUrl.pathname = "/chat";
        return NextResponse.redirect(chatUrl);
      }
    } catch {
      return toLogin();
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on all page routes, skip API and static assets
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
