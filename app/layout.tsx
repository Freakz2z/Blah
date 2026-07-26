import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "胡言乱语生成器",
  description: "根据你当前的精神状态，认真说一句废话。",
  icons: { icon: "/favicon.png", shortcut: "/favicon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
