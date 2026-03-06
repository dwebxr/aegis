import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        "text-display", "text-h1", "text-h2", "text-h3",
        "text-body-lg", "text-body", "text-body-sm",
        "text-caption", "text-tiny",
        "text-kpi", "text-kpi-sub", "text-kpi-label",
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
