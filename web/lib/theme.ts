/**
 * Theme persistence utilities
 * Handles light/dark theme with localStorage fallback and system preference detection
 */

export type Theme = "light" | "dark" | "glass" | "snow" | "goldred" | "brocade";

export const THEME_STORAGE_KEY = "deeptutor-theme";

/**
 * App-wide default theme for new browsers / new accounts: 南财（snow）。
 * 首屏 ThemeScript 兜底、AppShell 初始 state、initializeTheme 都以此为准，
 * 保证"实际渲染"与"设置页选中态"在无存储时一致。
 */
export const DEFAULT_THEME: Theme = "snow";

type ThemeChangeListener = (theme: Theme) => void;
const themeListeners = new Set<ThemeChangeListener>();

/**
 * Subscribe to theme changes
 */
export function subscribeToThemeChanges(
  listener: ThemeChangeListener,
): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

/**
 * Notify all listeners of theme change
 */
function notifyThemeChange(theme: Theme): void {
  themeListeners.forEach((listener) => listener(theme));
}

/**
 * Get the stored theme from localStorage
 */
export function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (
      stored === "light" ||
      stored === "dark" ||
      stored === "glass" ||
      stored === "snow" ||
      stored === "goldred" ||
      stored === "brocade"
    ) {
      return stored;
    }
  } catch (e) {
    // Silently fail - localStorage may be disabled
  }

  return null;
}

/**
 * Save theme to localStorage
 */
export function saveThemeToStorage(theme: Theme): boolean {
  if (typeof window === "undefined") return false;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch (e) {
    // Silently fail - localStorage may be disabled or full
    return false;
  }
}

/**
 * Get system preference for theme
 */
export function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Apply theme to document
 */
export function applyThemeToDocument(theme: Theme): void {
  if (typeof document === "undefined") return;

  const html = document.documentElement;

  html.classList.remove(
    "dark",
    "theme-glass",
    "theme-snow",
    "theme-goldred",
    "theme-light",
    "theme-brocade",
  );

  if (theme === "dark") {
    html.classList.add("dark");
  } else if (theme === "glass") {
    html.classList.add("dark", "theme-glass");
  } else if (theme === "snow") {
    html.classList.add("theme-snow");
  } else if (theme === "goldred") {
    // 红黄主题（亮色底+红黄主色，或深色底+红黄强调色）
    html.classList.add("theme-goldred");
  } else if (theme === "brocade") {
    // 云锦：玄黑织金深色主题
    html.classList.add("theme-brocade");
  } else if (theme === "light") {
    // 青瓷主题：内容区变量走 :root，theme-light 仅负责深墨绿侧边栏覆盖
    html.classList.add("theme-light");
  }
}

/**
 * Initialize theme on app startup
 * Priority: localStorage > app default (snow / 南财)
 */
export function initializeTheme(): Theme {
  // Check localStorage first
  const stored = getStoredTheme();
  if (stored) {
    applyThemeToDocument(stored);
    return stored;
  }

  // New browser / account: fall back to the app default and persist it so
  // later reads stay consistent (no longer follows OS light/dark preference).
  applyThemeToDocument(DEFAULT_THEME);
  saveThemeToStorage(DEFAULT_THEME);
  return DEFAULT_THEME;
}

/**
 * Set theme and persist it
 */
export function setTheme(theme: Theme): void {
  applyThemeToDocument(theme);
  saveThemeToStorage(theme);
  notifyThemeChange(theme);
}
