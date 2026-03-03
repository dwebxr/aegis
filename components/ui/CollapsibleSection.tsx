import React from "react";
import { colors, space, radii, transitions, type as t } from "@/styles/theme";

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
}: CollapsibleSectionProps) {
  return (
    <div
      data-testid={`aegis-section-${id}`}
      style={{
        background: "transparent",
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: radii.lg,
        overflow: "hidden",
        transition: transitions.fast,
      }}
    >
      <button
        onClick={() => onToggle(id)}
        style={{
          width: "100%",
          padding: `${space[3]}px ${space[4]}px`,
          background: isExpanded ? colors.bg.surface : "transparent",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: space[2],
          fontFamily: "inherit",
          transition: transitions.fast,
        }}
      >
        <span style={{ fontSize: mobile ? 16 : 14 }}>{icon}</span>
        <span
          style={{
            fontSize: t.bodySm.size,
            fontWeight: 600,
            color: colors.text.tertiary,
          }}
        >
          {title}
        </span>
        {itemCount !== undefined && itemCount > 0 && (
          <span
            style={{
              fontSize: t.caption.size,
              color: colors.text.muted,
              background: colors.bg.raised,
              padding: "2px 8px",
              borderRadius: radii.sm,
            }}
          >
            {itemCount}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {actionButton && isExpanded && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              actionButton.onClick();
            }}
            style={{
              fontSize: t.caption.size,
              fontWeight: 600,
              color: colors.cyan[400],
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              padding: `2px ${space[2]}px`,
            }}
          >
            {actionButton.label}
          </button>
        )}
        <span
          style={{
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: transitions.fast,
            fontSize: 12,
            color: colors.text.muted,
          }}
        >
          ▼
        </span>
      </button>
      {isExpanded && (
        <div
          style={{
            padding: `${space[3]}px ${space[4]}px`,
            borderTop: `1px solid ${colors.border.subtle}`,
            animation: "slideDown .2s ease forwards",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function SectionSkeleton({ mobile = false }: { mobile?: boolean }) {
  return (
    <div
      style={{
        padding: space[4],
        display: "flex",
        flexDirection: "column",
        gap: space[2],
        animation: "pulse 2s infinite",
      }}
    >
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: mobile ? 80 : 60,
            background: colors.bg.raised,
            borderRadius: radii.md,
            opacity: 0.5 - i * 0.1,
          }}
        />
      ))}
    </div>
  );
}