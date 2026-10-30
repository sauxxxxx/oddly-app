import { CalendarCheck, ChartColumn, Users } from "lucide-react";
import type * as React from "react";

import { LogoMark, Wordmark } from "@/components/brand/logo";

/** Two-panel frame for sign-in, owner setup and password screens. */
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
    <div className="grid h-full grid-cols-1 bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-accent/20 blur-[120px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-48 right-[-120px] size-[460px] rounded-full bg-magenta/15 blur-[120px]"
        />

        <div className="relative flex items-center gap-3">
          <LogoMark />
          <Wordmark />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em]">
            Everything your agency needs.
            <span className="block text-muted">All in one place.</span>
          </h2>
          <ul className="mt-10 flex flex-col gap-5 text-sm text-muted">
            {[
              { icon: Users, text: "Find and research local and international leads" },
              { icon: CalendarCheck, text: "Follow up, win deals and onboard clients" },
              { icon: ChartColumn, text: "Run content, websites and projects with your team" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl border border-line bg-raised text-accent">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-subtle">Internal workspace · authorized team members only</p>
      </aside>

      <main className="flex items-center justify-center overflow-y-auto p-8">
        <div className="w-full max-w-[400px] animate-pop-in">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark />
            <Wordmark />
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
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
