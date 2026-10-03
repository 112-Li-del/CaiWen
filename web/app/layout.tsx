import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Lora, Ma_Shan_Zheng } from "next/font/google";
import "./globals.css";
import ThemeScript from "@/components/ThemeScript";
import { AppShellProvider } from "@/context/AppShellContext";
import { I18nClientBridge } from "@/i18n/I18nClientBridge";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const fontSerif = Lora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
});

const fontCalligraphy = Ma_Shan_Zheng({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-calligraphy",
});

export const metadata: Metadata = {
  title: "财问",
  description: "Agent-native intelligent learning companion",
  icons: {
    icon: [
      { url: "/god.png", sizes: "16x16", type: "image/png" },
      { url: "/god.png", sizes: "32x32", type: "image/png" },
    ],
    // apple-touch-icon 需为不透明图（透明底在 iOS 主屏会变黑角），故保留不透明 jpg
    apple: "/god.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${fontSans.variable} ${fontSerif.variable} ${fontCalligraphy.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="font-sans bg-[var(--background)] text-[var(--foreground)]">
        <AppShellProvider>
          <I18nClientBridge>{children}</I18nClientBridge>
        </AppShellProvider>
      </body>
    </html>
  );
}
