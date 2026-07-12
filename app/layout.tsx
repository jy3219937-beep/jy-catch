import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "정율 캐치 — JY-Catch",
  description: "정율사관학원 캠 손동작 학습 게임",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          background: "#0a0a14",
          color: "#e8e8f0",
          fontFamily:
            '"Pretendard", "Inter", -apple-system, system-ui, sans-serif',
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {children}
      </body>
    </html>
  );
}
