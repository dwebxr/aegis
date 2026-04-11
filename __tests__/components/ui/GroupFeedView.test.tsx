/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GroupFeedView } from "@/components/ui/GroupFeedView";
import type { CurationGroup } from "@/lib/d2a/curationGroup";
import type { ContentItem } from "@/lib/types/content";

afterEach(() => cleanup());

// Stub ContentCard so this suite focuses on GroupFeedView. Each callback is
// re-exposed as a test button so we can verify the wiring.
jest.mock("@/components/ui/ContentCard", () => ({
  __esModule: true,
  ContentCard: ({
    item,
    expanded,
    onToggle,
    onValidate,
    onFlag,
    onTranslate,
    isTranslating,
  }: {
    item: { id: string; text: string };
    expanded?: boolean;
    onToggle: (id: string) => void;
    onValidate: (id: string) => void;
    onFlag: (id: string) => void;
    onTranslate?: (id: string) => void;
    isTranslating?: boolean;
  }) => (
    <div data-testid={`card-${item.id}`} data-expanded={expanded ? "1" : "0"} data-translating={isTranslating ? "1" : "0"}>
      <span>{item.text}</span>
      <button data-testid={`toggle-${item.id}`} onClick={() => onToggle(item.id)}>toggle</button>
      <button data-testid={`validate-${item.id}`} onClick={() => onValidate(item.id)}>validate</button>
      <button data-testid={`flag-${item.id}`} onClick={() => onFlag(item.id)}>flag</button>
      {onTranslate && (
        <button data-testid={`translate-${item.id}`} onClick={() => onTranslate(item.id)}>translate</button>
      )}
    </div>
  ),
}));

const baseGroup: CurationGroup = {
  id: "g1",
  dTag: "g1",
  name: "Test Group",
  description: "",
  topics: [],
  members: [
    "owner-aaaaaaaaaaaa",
    "member-bbbbbbbbbbbb",
    "member-cccccccccccc",
  ],
  ownerPk: "owner-aaaaaaaaaaaa",
  createdAt: 0,
  lastSynced: 0,
};

function makeItem(id: string, text = `text-${id}`): ContentItem {
  return {
    id,
    owner: "o",
    author: "a",
    avatar: "A",
    text,
    source: "rss",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "",
    createdAt: 0,
    validated: false,
    flagged: false,
    timestamp: "now",
  };
}

const baseProps = {
  group: baseGroup,
  feed: [makeItem("a"), makeItem("b")],
  isOwner: false,
  onValidate: jest.fn(),
  onFlag: jest.fn(),
};

describe("GroupFeedView", () => {
  it("renders feed items via ContentCard", () => {
    render(<GroupFeedView {...baseProps} />);
    expect(screen.getByTestId("card-a")).toBeInTheDocument();
    expect(screen.getByTestId("card-b")).toBeInTheDocument();
  });

  it("shows empty state when feed is empty", () => {
    render(<GroupFeedView {...baseProps} feed={[]} />);
    expect(screen.getByText(/No validated content/i)).toBeInTheDocument();
  });

  it("Members button toggles members panel", () => {
    render(<GroupFeedView {...baseProps} />);
    const btn = screen.getByText(/Members \(3\)/);
    expect(screen.queryByText(/owner-aaaaaa/)).not.toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.getByText(/owner-aaaaaa/)).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByText(/owner-aaaaaa/)).not.toBeInTheDocument();
  });

  it("Sync button only renders when onSync supplied; click invokes it", () => {
    const onSync = jest.fn();
    const { rerender } = render(<GroupFeedView {...baseProps} />);
    expect(screen.queryByText("Sync")).not.toBeInTheDocument();

    rerender(<GroupFeedView {...baseProps} onSync={onSync} />);
    fireEvent.click(screen.getByText("Sync"));
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("annotates current user with (you) and owner with (owner)", () => {
    render(
      <GroupFeedView
        {...baseProps}
        currentUserPk="member-bbbbbbbbbbbb"
      />,
    );
    fireEvent.click(screen.getByText(/Members \(/));
    expect(screen.getByText(/\(you\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(owner\)/)).toBeInTheDocument();
  });

  it("non-owners cannot see Remove or Add controls", () => {
    render(<GroupFeedView {...baseProps} onAddMember={jest.fn()} onRemoveMember={jest.fn()} />);
    fireEvent.click(screen.getByText(/Members \(/));
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
    expect(screen.queryByText("Add")).not.toBeInTheDocument();
  });

  it("owner sees a Remove button per non-owner member only", () => {
    const onRemoveMember = jest.fn();
    render(
      <GroupFeedView
        {...baseProps}
        isOwner
        onRemoveMember={onRemoveMember}
      />,
    );
    fireEvent.click(screen.getByText(/Members \(/));
    const removeButtons = screen.getAllByText("Remove");
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    expect(onRemoveMember).toHaveBeenCalledWith("member-bbbbbbbbbbbb");
  });

  it("owner can add a new member; trims input and clears after add", () => {
    const onAddMember = jest.fn();
    render(<GroupFeedView {...baseProps} isOwner onAddMember={onAddMember} />);
    fireEvent.click(screen.getByText(/Members \(/));
    const input = screen.getByPlaceholderText(/npub or hex pubkey/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  newmember123  " } });
    fireEvent.click(screen.getByText("Add"));
    expect(onAddMember).toHaveBeenCalledWith("newmember123");
    expect(input.value).toBe("");
  });

  it("Add button does nothing for whitespace-only input", () => {
    const onAddMember = jest.fn();
    render(<GroupFeedView {...baseProps} isOwner onAddMember={onAddMember} />);
    fireEvent.click(screen.getByText(/Members \(/));
    fireEvent.click(screen.getByText("Add"));
    expect(onAddMember).not.toHaveBeenCalled();

    const input = screen.getByPlaceholderText(/npub or hex pubkey/i);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByText("Add"));
    expect(onAddMember).not.toHaveBeenCalled();
  });

  it("forwards onValidate / onFlag with item id when child fires the callback", () => {
    const onValidate = jest.fn();
    const onFlag = jest.fn();
    render(
      <GroupFeedView {...baseProps} onValidate={onValidate} onFlag={onFlag} />,
    );
    fireEvent.click(screen.getByTestId("validate-a"));
    fireEvent.click(screen.getByTestId("flag-b"));
    expect(onValidate).toHaveBeenCalledTimes(1);
    expect(onValidate).toHaveBeenCalledWith("a");
    expect(onFlag).toHaveBeenCalledTimes(1);
    expect(onFlag).toHaveBeenCalledWith("b");
  });

  it("handleToggle expands one item at a time and collapses on second click", () => {
    render(<GroupFeedView {...baseProps} />);
    expect(screen.getByTestId("card-a").dataset.expanded).toBe("0");
    expect(screen.getByTestId("card-b").dataset.expanded).toBe("0");

    fireEvent.click(screen.getByTestId("toggle-a"));
    expect(screen.getByTestId("card-a").dataset.expanded).toBe("1");
    expect(screen.getByTestId("card-b").dataset.expanded).toBe("0");

    fireEvent.click(screen.getByTestId("toggle-b"));
    expect(screen.getByTestId("card-a").dataset.expanded).toBe("0");
    expect(screen.getByTestId("card-b").dataset.expanded).toBe("1");

    fireEvent.click(screen.getByTestId("toggle-b"));
    expect(screen.getByTestId("card-b").dataset.expanded).toBe("0");
  });

  it("forwards onTranslate and propagates isItemTranslating return value", () => {
    const onTranslate = jest.fn();
    const isItemTranslating = jest.fn((id: string) => id === "a");
    render(
      <GroupFeedView
        {...baseProps}
        onTranslate={onTranslate}
        isItemTranslating={isItemTranslating}
      />,
    );
    expect(isItemTranslating).toHaveBeenCalledWith("a");
    expect(isItemTranslating).toHaveBeenCalledWith("b");
    expect(screen.getByTestId("card-a").dataset.translating).toBe("1");
    expect(screen.getByTestId("card-b").dataset.translating).toBe("0");
    fireEvent.click(screen.getByTestId("translate-a"));
    expect(onTranslate).toHaveBeenCalledWith("a");
  });

  it("does not pass translate button when onTranslate is undefined", () => {
    render(<GroupFeedView {...baseProps} />);
    expect(screen.queryByTestId("translate-a")).not.toBeInTheDocument();
  });
});
