"use client";
import React from "react";

interface NewItemsBarProps {
  count: number;
  onFlush: () => void;
}

export const NewItemsBar: React.FC<NewItemsBarProps> = ({ count, onFlush }) => {
  if (count === 0) return null;

  return (
    <button
      data-testid="new-items-bar"
      onClick={onFlush}
      className="block w-full px-3 py-2 mb-2 bg-amber-400/[0.07] border border-amber-400/20 rounded-md text-amber-400 text-body-sm font-semibold font-sans cursor-pointer text-center transition-fast animate-slide-up"
    >
      {count} new article{count !== 1 ? "s" : ""} — tap to show
    </button>
  );
};
