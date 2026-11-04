import type * as React from "react";

import { LogoMark, Wordmark } from "@/components/brand/logo";

/** Plain centered frame for sign-in, owner setup and password screens. */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex h-full items-center justify-center overflow-y-auto bg-canvas p-8">
      <div className="w-full max-w-[360px]">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark />
          <Wordmark />
        </div>
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function FormAlert({ children, tone = "danger" }: { children: React.ReactNode; tone?: "danger" | "info" }) {
  return (
    <div
      role="alert"
      className={
        tone === "danger"
          ? "rounded-control border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger-fg"
          : "rounded-control border border-info/25 bg-info-soft px-3.5 py-2.5 text-[13px] text-info-fg"
      }
    >
      {children}
    </div>
  );
}
