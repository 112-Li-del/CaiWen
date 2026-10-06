/**
 * ThemeScript - Initializes theme from localStorage before React hydration
 * This prevents the flash of wrong theme on page load.
 *
 * Must be a Server Component: in Next.js / React 19, <script> tags rendered
 * by Client Components are inert on the client. Rendering it from the server
 * inlines the snippet into the SSR HTML so the browser executes it before
 * hydration.
 */
// ThemeScript.tsx
export default function ThemeScript() {
  const themeScript = `
    (function() {
      try {
        const stored = localStorage.getItem('deeptutor-theme');
        document.documentElement.classList.remove('dark', 'theme-glass', 'theme-snow', 'theme-goldred', 'theme-light');

        if (stored === 'dark') {
          document.documentElement.classList.add('dark');
        } else if (stored === 'glass') {
          document.documentElement.classList.add('dark', 'theme-glass');
        } else if (stored === 'snow') {
          document.documentElement.classList.add('theme-snow');
        } else if (stored === 'goldred') { // 新增
          document.documentElement.classList.add('theme-goldred');
        } else if (stored === 'light') {
          document.documentElement.classList.add('theme-light');
        } else {
          document.documentElement.classList.add('theme-goldred');
          localStorage.setItem('deeptutor-theme', 'goldred');
        }
      } catch (e) {}
    })();
  `;

  return (
    <script
      dangerouslySetInnerHTML={{ __html: themeScript }}
      suppressHydrationWarning
    />
  );
}

 
