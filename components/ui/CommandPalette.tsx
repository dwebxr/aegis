"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { SearchIcon } from "@/components/icons";
import { colors, space, type as t, radii, transitions, fonts } from "@/styles/theme";

export interface PaletteCommand {
  label: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  mobile?: boolean;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, commands, mobile }) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() =>
    query ? commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase())) : commands,
    [query, commands],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Focus input on next frame to ensure mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const execute = useCallback((cmd: PaletteCommand) => {
    cmd.action();
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[selectedIndex]) execute(filtered[selectedIndex]);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  }, [filtered, selectedIndex, execute, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: mobile ? 40 : 120,
        animation: "fadeIn .15s ease",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: mobile ? "calc(100% - 32px)" : 520,
          maxHeight: 400,
          background: colors.bg.surface,
          border: `1px solid ${colors.border.emphasis}`,
          borderRadius: radii.xl,
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{
          display: "flex", alignItems: "center", gap: space[3],
          padding: `${space[3]}px ${space[4]}px`,
          borderBottom: `1px solid ${colors.border.default}`,
        }}>
          <SearchIcon s={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: colors.text.primary, fontSize: t.body.size,
              fontFamily: fonts.sans,
            }}
          />
          <span style={{
            fontSize: t.tiny.size, color: colors.text.disabled,
            padding: "2px 6px", border: `1px solid ${colors.border.default}`,
            borderRadius: radii.sm, fontFamily: fonts.mono,
          }}>ESC</span>
        </div>

        {/* Command list */}
        <div style={{ maxHeight: 320, overflowY: "auto", padding: `${space[2]}px 0` }}>
          {filtered.length === 0 ? (
            <div style={{
              padding: `${space[4]}px ${space[4]}px`,
              textAlign: "center", color: colors.text.disabled,
              fontSize: t.bodySm.size,
            }}>
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.label}
                onClick={() => execute(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  display: "flex", alignItems: "center", width: "100%",
                  padding: `${space[2]}px ${space[4]}px`,
                  background: i === selectedIndex ? `${colors.cyan[400]}10` : "transparent",
                  border: "none", cursor: "pointer",
                  color: i === selectedIndex ? colors.cyan[400] : colors.text.secondary,
                  fontSize: t.bodySm.size, fontWeight: 500,
                  fontFamily: fonts.sans,
                  transition: transitions.fast,
                  textAlign: "left",
                }}
              >
                {cmd.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
