import * as S from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import { controlClass } from "./control";

/** Radix doesn't allow an empty item value, but "All" / "None" options use one. */
const EMPTY = "__empty__";
const toItem = (v: string) => (v === "" ? EMPTY : v);
const fromItem = (v: string) => (v === EMPTY ? "" : v);

interface Option {
  value: string;
  label: string;
  disabled: boolean;
}

function nodeText(node: React.ReactNode): string {
  return React.Children.toArray(node)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
    .join("");
}

/** Reads the <option> children, so the component is used exactly like a native <select>. */
function readOptions(children: React.ReactNode): Option[] {
  const options: Option[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    if (child.type === "option") {
      const label = nodeText(props.children);
      options.push({ value: String(props.value ?? label), label, disabled: !!props.disabled });
    } else {
      options.push(...readOptions(props.children));
    }
  });
  return options;
}

/** Custom dropdown with the same props as a native <select>, <option> children included. */
export const Select = React.forwardRef<HTMLButtonElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, value, defaultValue, onChange, disabled, required, name, ...trigger }, ref) => {
    const options = readOptions(children);
    const [own, setOwn] = React.useState(defaultValue === undefined ? undefined : String(defaultValue));
    const wanted = value === undefined ? own : String(value);
    // Like a native select, show the first option when the value matches none of them.
    const selected = options.find((o) => o.value === wanted) ?? options[0];

    function change(item: string) {
      const next = fromItem(item);
      setOwn(next);
      onChange?.({ target: { value: next }, currentTarget: { value: next } } as React.ChangeEvent<HTMLSelectElement>);
    }

    return (
      <S.Root value={selected ? toItem(selected.value) : undefined} onValueChange={change} disabled={disabled} required={required} name={name}>
        <S.Trigger
          ref={ref}
          className={cn(controlClass, "flex items-center justify-between gap-2 text-left [&>span:first-child]:truncate", className)}
          {...(trigger as React.ComponentPropsWithoutRef<typeof S.Trigger>)}
        >
          <S.Value>{selected?.label}</S.Value>
          <S.Icon asChild>
            <ChevronDown className="size-4 shrink-0 text-subtle" />
          </S.Icon>
        </S.Trigger>
        <S.Portal>
          <S.Content
            position="popper"
            sideOffset={6}
            // Portaled clicks still bubble through React: don't trigger clickable rows behind it.
            onClick={(e) => e.stopPropagation()}
            className="z-[70] max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-line bg-overlay shadow-pop"
          >
            <S.ScrollUpButton className="flex h-7 items-center justify-center text-subtle">
              <ChevronUp className="size-4" />
            </S.ScrollUpButton>
            <S.Viewport className="p-1.5">
              {options.map((o) => (
                <S.Item
                  key={o.value}
                  value={toItem(o.value)}
                  disabled={o.disabled}
                  className="relative flex cursor-pointer select-none items-center rounded-md py-2 pl-2.5 pr-8 text-sm text-fg outline-none transition-colors data-[highlighted]:bg-raised data-[state=checked]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                >
                  <S.ItemText>{o.label}</S.ItemText>
                  <S.ItemIndicator className="absolute right-2.5">
                    <Check className="size-4 text-accent" />
                  </S.ItemIndicator>
                </S.Item>
              ))}
            </S.Viewport>
            <S.ScrollDownButton className="flex h-7 items-center justify-center text-subtle">
              <ChevronDown className="size-4" />
            </S.ScrollDownButton>
          </S.Content>
        </S.Portal>
      </S.Root>
    );
  },
);
Select.displayName = "Select";
