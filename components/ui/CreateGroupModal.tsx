"use client";
import React, { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { colors, space, radii, type as t, transitions, fonts } from "@/styles/theme";
import type { CurationGroup } from "@/lib/d2a/curationGroup";

interface CreateGroupModalProps {
  ownerPk: string;
  onClose: () => void;
  onCreate: (group: CurationGroup) => void;
  mobile?: boolean;
}

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
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.6)",
    }} onClick={onClose}>
      <div style={{
        background: colors.bg.surface,
        border: `1px solid ${colors.border.default}`,
        borderRadius: radii.lg,
        padding: mobile ? space[4] : space[6],
        width: "min(420px, 90vw)",
        maxHeight: "80vh",
        overflow: "auto",
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{
          fontSize: t.h2.size, fontWeight: t.h2.weight,
          color: colors.text.primary, margin: 0, marginBottom: space[4],
        }}>
          Create Curation Group
        </h3>

        {/* Name */}
        <label style={{ fontSize: t.caption.size, color: colors.text.muted, fontWeight: 600, textTransform: "uppercase" }}>
          Group Name *
        </label>
        <input
          value={name}
          onChange={e => setName(e.target.value.slice(0, 50))}
          placeholder="e.g. AI Research"
          style={{
            width: "100%", padding: space[2],
            background: colors.bg.raised, border: `1px solid ${colors.border.default}`,
            borderRadius: radii.sm, color: colors.text.secondary,
            fontSize: t.body.size, fontFamily: fonts.sans,
            marginTop: space[1], marginBottom: space[3],
            boxSizing: "border-box",
          }}
        />

        {/* Description */}
        <label style={{ fontSize: t.caption.size, color: colors.text.muted, fontWeight: 600, textTransform: "uppercase" }}>
          Description
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value.slice(0, 200))}
          placeholder="What is this group about?"
          rows={2}
          style={{
            width: "100%", padding: space[2],
            background: colors.bg.raised, border: `1px solid ${colors.border.default}`,
            borderRadius: radii.sm, color: colors.text.secondary,
            fontSize: t.body.size, fontFamily: fonts.sans,
            marginTop: space[1], marginBottom: space[3],
            resize: "vertical", boxSizing: "border-box",
          }}
        />

        {/* Topics */}
        <label style={{ fontSize: t.caption.size, color: colors.text.muted, fontWeight: 600, textTransform: "uppercase" }}>
          Topics
        </label>
        <div style={{ display: "flex", gap: space[1], marginTop: space[1], marginBottom: space[1], flexWrap: "wrap" }}>
          {topics.map(tp => (
            <span key={tp} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: `1px ${space[2]}px`,
              background: `${colors.cyan[400]}12`,
              border: `1px solid ${colors.cyan[400]}25`,
              borderRadius: radii.pill,
              fontSize: t.caption.size, color: colors.cyan[400],
            }}>
              {tp}
              <button
                onClick={() => setTopics(topics.filter(x => x !== tp))}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: colors.text.disabled, fontSize: 12, padding: 0,
                  lineHeight: 1, fontFamily: "inherit",
                }}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: space[1], marginBottom: space[4] }}>
          <input
            value={topicInput}
            onChange={e => setTopicInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTopic(); } }}
            placeholder="Add topic..."
            style={{
              flex: 1, padding: `${space[1]}px ${space[2]}px`,
              background: colors.bg.raised, border: `1px solid ${colors.border.default}`,
              borderRadius: radii.sm, color: colors.text.secondary,
              fontSize: t.bodySm.size, fontFamily: fonts.sans,
            }}
          />
          <button onClick={addTopic} style={{
            padding: `${space[1]}px ${space[2]}px`,
            background: colors.bg.raised, border: `1px solid ${colors.border.default}`,
            borderRadius: radii.sm, color: colors.text.muted,
            fontSize: t.bodySm.size, cursor: "pointer", fontFamily: "inherit",
          }}>
            +
          </button>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            padding: `${space[2]}px ${space[4]}px`,
            background: "transparent", border: `1px solid ${colors.border.default}`,
            borderRadius: radii.sm, color: colors.text.muted,
            fontSize: t.bodySm.size, fontWeight: 600, cursor: "pointer",
            fontFamily: "inherit", transition: transitions.fast,
          }}>
            Cancel
          </button>
          <button onClick={handleCreate} disabled={!canCreate} style={{
            padding: `${space[2]}px ${space[4]}px`,
            background: canCreate ? `${colors.purple[400]}18` : "transparent",
            border: `1px solid ${canCreate ? `${colors.purple[400]}33` : colors.border.default}`,
            borderRadius: radii.sm,
            color: canCreate ? colors.purple[400] : colors.text.disabled,
            fontSize: t.bodySm.size, fontWeight: 700, cursor: canCreate ? "pointer" : "default",
            fontFamily: "inherit", transition: transitions.fast,
          }}>
            Create Group
          </button>
        </div>
      </div>
    </div>
  );
};
