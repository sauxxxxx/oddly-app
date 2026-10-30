import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
];

/** Dark / Light / System segmented control. */
export function ThemeSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const { preference, setPreference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Appearance" className={cn("inline-flex rounded-control border border-line bg-raised p-1", className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={(e) => {
            e.stopPropagation();
            setPreference(value);
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[13px] font-medium transition-colors",
            preference === value ? "bg-card text-fg shadow-sm" : "text-subtle hover:text-fg",
          )}
        >
          <Icon className="size-3.5" />
          {!compact && label}
        </button>
      ))}
    </div>
  );
}
