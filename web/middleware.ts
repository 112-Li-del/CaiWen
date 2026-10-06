import { NextRequest, NextResponse } from "next/server";
import { decodeJwt } from "jose";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
const LOGIN_PATH = "/login";
const COOKIE_NAME = "dt_token";

// Pages that require admin role
const ADMIN_ROUTES = ["/knowledge", "/space", "/agents", "/co-writer", "/book"];

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

export function middleware(req: NextRequest) {
  // Auth is disabled (default) — let everything through
  if (!AUTH_ENABLED) return NextResponse.next();

  const { pathname } = req.nextUrl;

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

  const token = req.cookies.get(COOKIE_NAME)?.value;

  // No token — redirect to login, preserving the intended destination
  if (!token) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only routes: check the JWT role claim
  if (isAdminRoute(pathname)) {
    try {
      const payload = decodeJwt(token);
      if (payload.role !== "admin") {
        // Non-admin user trying to access an admin-only page — redirect to /chat
        const chatUrl = req.nextUrl.clone();
        chatUrl.pathname = "/chat";
        return NextResponse.redirect(chatUrl);
      }
    } catch {
      // Invalid JWT — redirect to login
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = LOGIN_PATH;
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on all page routes, skip API and static assets
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
