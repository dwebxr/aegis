import React from "react";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  id: string;
  title: string;
  icon: string;
  children: React.ReactNode;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  itemCount?: number;
  actionButton?: {
    label: string;
    onClick: () => void;
  };
  mobile?: boolean;
  wrapperRef?: React.Ref<HTMLDivElement>;
}

export function CollapsibleSection({
  id,
  title,
  icon,
  children,
  isExpanded,
  onToggle,
  itemCount,
  actionButton,
  mobile = false,
  wrapperRef,
}: CollapsibleSectionProps) {
  return (
    <div
      ref={wrapperRef}
      data-testid={`aegis-section-${id}`}
      className="border border-subtle rounded-lg overflow-hidden transition-all duration-150"
    >
      <button
        onClick={() => onToggle(id)}
        className={cn(
          "w-full px-4 py-3 border-none cursor-pointer flex items-center gap-2 font-[inherit] transition-all duration-150",
          isExpanded ? "bg-card" : "bg-transparent"
        )}
      >
        <span className={mobile ? "text-base" : "text-sm"}>{icon}</span>
        <span className="text-body-sm font-semibold text-tertiary">
          {title}
        </span>
        {itemCount !== undefined && itemCount > 0 && (
          <span className="text-caption text-muted-foreground bg-navy-lighter px-2 py-0.5 rounded-sm">
            {itemCount}
          </span>
        )}
        <div className="flex-1" />
        {actionButton && isExpanded && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              actionButton.onClick();
            }}
            className="text-caption font-semibold text-cyan-400 bg-transparent border-none cursor-pointer font-[inherit] px-2 py-0.5"
          >
            {actionButton.label}
          </button>
        )}
        <span
          className={cn(
            "text-xs text-muted-foreground transition-transform duration-150",
            isExpanded && "rotate-180"
          )}
        >
          &#x25BC;
        </span>
      </button>
      {isExpanded && (
        <div className="px-4 py-3 border-t border-subtle animate-slide-up">
          {children}
        </div>
      )}
    </div>
  );
}

export function SectionSkeleton({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className="p-4 flex flex-col gap-2 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn("bg-navy-lighter rounded-md", mobile ? "h-20" : "h-15")}
          style={{ opacity: 0.5 - i * 0.1 }}
        />
      ))}
    </div>
  );
}
