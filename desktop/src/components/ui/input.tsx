import * as React from "react";

import { cn } from "@/lib/utils";

import { controlClass } from "./control";
import { DatePicker } from "./date-picker";

export { controlClass } from "./control";
export { Select } from "./select";

/** `type="date"` and `type="datetime-local"` render the custom date picker. */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    if (type === "date" || type === "datetime-local") {
      const { value, onChange, min, max, disabled, id, placeholder, ...rest } = props;
      return (
        <DatePicker
          type={type as "date" | "datetime-local"}
          id={id}
          value={value === undefined ? undefined : String(value)}
          onChange={onChange}
          min={min === undefined ? undefined : String(min)}
          max={max === undefined ? undefined : String(max)}
          disabled={disabled}
          placeholder={placeholder}
          className={className}
          aria-invalid={rest["aria-invalid"]}
          aria-label={rest["aria-label"]}
        />
      );
    }
    return <input ref={ref} type={type} className={cn(controlClass, className)} {...props} />;
  },
);
Input.displayName = "Input";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-muted", className)} {...props} />;
}

/** Label + control + error/help text, with the error wired to aria. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
