"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { SearchIcon } from "@/components/icons";

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
      className="fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm flex items-start justify-center animate-fade-in"
      style={{ paddingTop: mobile ? 40 : 120 }}
      onClick={onClose}
    >
      <div
        className={cn(
          "max-h-[400px] bg-card border border-emphasis rounded-xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.5)]",
          mobile ? "w-[calc(100%-32px)]" : "w-[520px]"
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <SearchIcon s={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent border-none outline-none text-foreground text-body font-sans"
          />
          <span className="text-tiny text-disabled px-1.5 py-0.5 border border-border rounded-sm font-mono">ESC</span>
        </div>

        {/* Command list */}
        <div className="max-h-[320px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-disabled text-body-sm">
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.label}
                onClick={() => execute(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={cn(
                  "flex items-center w-full px-4 py-2 border-none cursor-pointer text-body-sm font-medium font-sans transition-fast text-left",
                  i === selectedIndex
                    ? "bg-cyan-400/[0.06] text-cyan-400"
                    : "bg-transparent text-secondary-foreground"
                )}
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
