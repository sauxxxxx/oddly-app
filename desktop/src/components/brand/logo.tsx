import { cn } from "@/lib/utils";

/** ODDLY mark: a ring knocked slightly off-centre, with its "odd" dot. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={cn("size-9", className)} aria-hidden>
      <defs>
        <linearGradient id="oddly-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B66BFA" />
          <stop offset="1" stopColor="#D946EF" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill="url(#oddly-mark)" />
      <circle cx="236" cy="268" r="118" fill="none" stroke="#fff" strokeWidth="56" />
      <circle cx="372" cy="138" r="38" fill="#fff" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("text-[17px] font-bold tracking-[0.14em] text-fg", className)}>ODDLY</span>;
}
