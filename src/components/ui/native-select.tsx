import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `<select>` nativo estilizado para matchear el Input de shadcn. Evita sumar
 * `@radix-ui/react-select` para el MVP; se puede migrar al Select de shadcn más
 * adelante sin tocar la lógica de los forms.
 */
const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
