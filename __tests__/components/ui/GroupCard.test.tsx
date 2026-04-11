/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupCard } from "@/components/ui/GroupCard";
import type { CurationGroup } from "@/lib/d2a/curationGroup";

afterEach(() => cleanup());

const baseGroup: CurationGroup = {
  id: "g1",
  dTag: "g1",
  name: "Crypto Researchers",
  description: "A small group of crypto researchers",
  ownerPk: "owner-pk",
  members: ["owner-pk", "member1", "member2"],
  topics: ["crypto", "research"],
  createdAt: 0,
  lastSynced: 0,
};

describe("GroupCard", () => {
  it("renders group name, member count and feed count", () => {
    const html = renderToStaticMarkup(
      <GroupCard
        group={baseGroup}
        feedCount={42}
        isOwner={false}
        expanded={false}
        onToggle={() => {}}
      />,
    );
    expect(html).toContain("Crypto Researchers");
    expect(html).toContain("42");
    expect(html).toContain("3 members");
  });

  it("uses singular 'member' for groups with one member", () => {
    const html = renderToStaticMarkup(
      <GroupCard
        group={{ ...baseGroup, members: ["only-one"] }}
        feedCount={0}
        isOwner={false}
        expanded={false}
        onToggle={() => {}}
      />,
    );
    expect(html).toContain("1 member");
    expect(html).not.toContain("1 members");
  });

  it("renders all topics as pills", () => {
    const html = renderToStaticMarkup(
      <GroupCard
        group={{ ...baseGroup, topics: ["alpha", "beta", "gamma"] }}
        feedCount={0}
        isOwner={false}
        expanded={false}
        onToggle={() => {}}
      />,
    );
    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("gamma");
  });

  it("shows Owner badge when isOwner=true", () => {
    const html = renderToStaticMarkup(
      <GroupCard
        group={baseGroup}
        feedCount={0}
        isOwner
        expanded={false}
        onToggle={() => {}}
      />,
    );
    expect(html).toContain("Owner");
  });

  it("hides Owner badge when isOwner=false", () => {
    const html = renderToStaticMarkup(
      <GroupCard
        group={baseGroup}
        feedCount={0}
        isOwner={false}
        expanded={false}
        onToggle={() => {}}
      />,
    );
    expect(html).not.toContain(">Owner<");
  });

  it("shows Delete button only when isOwner and onDelete supplied", () => {
    const withDelete = renderToStaticMarkup(
      <GroupCard
        group={baseGroup}
        feedCount={0}
        isOwner
        expanded={false}
        onToggle={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(withDelete).toContain("Delete");

    const ownerNoCb = renderToStaticMarkup(
      <GroupCard group={baseGroup} feedCount={0} isOwner expanded={false} onToggle={() => {}} />,
    );
    expect(ownerNoCb).not.toContain("Delete");

    const notOwner = renderToStaticMarkup(
      <GroupCard
        group={baseGroup}
        feedCount={0}
        isOwner={false}
        expanded={false}
        onToggle={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(notOwner).not.toContain("Delete");
  });

  it("hides description block when description missing", () => {
    const html = renderToStaticMarkup(
      <GroupCard
        group={{ ...baseGroup, description: "" }}
        feedCount={0}
        isOwner={false}
        expanded={false}
        onToggle={() => {}}
      />,
    );
    expect(html).not.toContain("A small group of crypto researchers");
  });

  it("applies expanded border when expanded=true", () => {
    const html = renderToStaticMarkup(
      <GroupCard group={baseGroup} feedCount={0} isOwner={false} expanded onToggle={() => {}} />,
    );
    expect(html).toContain("border-purple-400/20");
  });

  it("uses mobile padding/text when mobile=true", () => {
    const html = renderToStaticMarkup(
      <GroupCard group={baseGroup} feedCount={0} isOwner={false} expanded={false} onToggle={() => {}} mobile />,
    );
    expect(html).toContain("p-3");
    expect(html).not.toContain(' p-4 ');
  });

  it("clicking the card calls onToggle", () => {
    const onToggle = jest.fn();
    render(
      <GroupCard group={baseGroup} feedCount={5} isOwner={false} expanded={false} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByText("Crypto Researchers"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("clicking Delete button stops propagation and calls onDelete", () => {
    const onToggle = jest.fn();
    const onDelete = jest.fn();
    render(
      <GroupCard
        group={baseGroup}
        feedCount={0}
        isOwner
        expanded={false}
        onToggle={onToggle}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
