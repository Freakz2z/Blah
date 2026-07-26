import type { Metadata, Viewport } from "next";
import "./globals.css";

const description = "根据你当前的精神状态，认真说一句废话。";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://blah.freakz2z.com"),
  title: "胡言乱语生成器",
  description,
  icons: { icon: "/favicon.png", shortcut: "/favicon.png" },
  openGraph: {
    title: "胡言乱语生成器",
    description,
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f8f6" },
    { media: "(prefers-color-scheme: dark)", color: "#131210" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {/* Self-hosted Noto Serif SC (unicode-range slices) — React hoists
            this into <head>; browsers fetch only the slices a page uses.
            Kept as a public asset: importing the 350KB slice CSS through the
            bundler would inline it into the app stylesheet. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/fonts/serif.css" precedence="default" />
        {children}
      </body>
    </html>
  );
}
