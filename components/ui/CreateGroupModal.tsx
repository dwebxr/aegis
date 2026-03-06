"use client";
import React, { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { cn } from "@/lib/utils";
import type { CurationGroup } from "@/lib/d2a/curationGroup";

interface CreateGroupModalProps {
  ownerPk: string;
  onClose: () => void;
  onCreate: (group: CurationGroup) => void;
  mobile?: boolean;
}

const inputClass = "w-full p-2 bg-navy-lighter border border-border rounded-sm text-secondary-foreground text-body font-sans box-border";

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  ownerPk, onClose, onCreate, mobile,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [topicInput, setTopicInput] = useState("");
  const [topics, setTopics] = useState<string[]>([]);

  const canCreate = name.trim().length > 0;

  const addTopic = () => {
    const trimmed = topicInput.trim().toLowerCase();
    if (trimmed && !topics.includes(trimmed)) {
      setTopics([...topics, trimmed]);
    }
    setTopicInput("");
  };

  const handleCreate = () => {
    if (!canCreate) return;
    const id = uuidv4();
    const group: CurationGroup = {
      id,
      dTag: `aegis-group-${id}`,
      name: name.trim(),
      description: description.trim(),
      topics,
      members: [ownerPk],
      ownerPk,
      createdAt: Date.now(),
      lastSynced: 0,
    };
    onCreate(group);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className={cn("bg-card border border-border rounded-lg w-[min(420px,90vw)] max-h-[80vh] overflow-auto", mobile ? "p-4" : "p-6")} onClick={e => e.stopPropagation()}>
        <h3 className="text-h2 font-bold text-foreground m-0 mb-4">
          Create Curation Group
        </h3>

        {/* Name */}
        <label className="text-caption text-muted-foreground font-semibold uppercase">
          Group Name *
        </label>
        <input
          value={name}
          onChange={e => setName(e.target.value.slice(0, 50))}
          placeholder="e.g. AI Research"
          className={cn(inputClass, "mt-1 mb-3")}
        />

        {/* Description */}
        <label className="text-caption text-muted-foreground font-semibold uppercase">
          Description
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value.slice(0, 200))}
          placeholder="What is this group about?"
          rows={2}
          className={cn(inputClass, "mt-1 mb-3 resize-y")}
        />

        {/* Topics */}
        <label className="text-caption text-muted-foreground font-semibold uppercase">
          Topics
        </label>
        <div className="flex gap-1 mt-1 mb-1 flex-wrap">
          {topics.map(tp => (
            <span key={tp} className="inline-flex items-center gap-1 px-2 py-px bg-cyan-400/[0.07] border border-cyan-400/15 rounded-full text-caption text-cyan-400">
              {tp}
              <button
                onClick={() => setTopics(topics.filter(x => x !== tp))}
                className="bg-transparent border-none cursor-pointer text-[var(--color-text-disabled)] text-[12px] p-0 leading-none font-[inherit]"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1 mb-4">
          <input
            value={topicInput}
            onChange={e => setTopicInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTopic(); } }}
            placeholder="Add topic..."
            className="flex-1 px-2 py-1 bg-navy-lighter border border-border rounded-sm text-secondary-foreground text-body-sm font-sans"
          />
          <button onClick={addTopic} className="px-2 py-1 bg-navy-lighter border border-border rounded-sm text-muted-foreground text-body-sm cursor-pointer font-[inherit]">
            +
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-transparent border border-border rounded-sm text-muted-foreground text-body-sm font-semibold cursor-pointer font-[inherit] transition-fast">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={!canCreate} className={cn(
            "px-4 py-2 rounded-sm text-body-sm font-bold font-[inherit] transition-fast border",
            canCreate
              ? "bg-purple-400/[0.09] border-purple-400/20 text-purple-400 cursor-pointer"
              : "bg-transparent border-border text-[var(--color-text-disabled)] cursor-default"
          )}>
            Create Group
          </button>
        </div>
      </div>
    </div>
  );
};
