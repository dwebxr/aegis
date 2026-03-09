/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("uuid", () => ({ v4: () => "mock-uuid-1234" }));

import { CreateGroupModal } from "@/components/ui/CreateGroupModal";

const defaultProps = {
  ownerPk: "owner-pk-abc",
  onClose: jest.fn(),
  onCreate: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("CreateGroupModal", () => {
  it("renders modal with title", () => {
    render(<CreateGroupModal {...defaultProps} />);
    expect(screen.getByText("Create Curation Group")).toBeInTheDocument();
  });

  it("Create button is disabled when name is empty", () => {
    render(<CreateGroupModal {...defaultProps} />);
    const createBtn = screen.getByText("Create Group") as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
  });

  it("Create button enables when name is entered", () => {
    render(<CreateGroupModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("e.g. AI Research");
    fireEvent.change(nameInput, { target: { value: "My Group" } });

    const createBtn = screen.getByText("Create Group") as HTMLButtonElement;
    expect(createBtn.disabled).toBe(false);
  });

  it("calls onCreate with group data on submit", () => {
    render(<CreateGroupModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("e.g. AI Research");
    fireEvent.change(nameInput, { target: { value: "Test Group" } });

    fireEvent.click(screen.getByText("Create Group"));

    expect(defaultProps.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mock-uuid-1234",
        name: "Test Group",
        ownerPk: "owner-pk-abc",
        members: ["owner-pk-abc"],
        topics: [],
      }),
    );
  });

  it("does not call onCreate when name is empty", () => {
    render(<CreateGroupModal {...defaultProps} />);
    fireEvent.click(screen.getByText("Create Group"));
    expect(defaultProps.onCreate).not.toHaveBeenCalled();
  });

  it("calls onClose when Cancel is clicked", () => {
    render(<CreateGroupModal {...defaultProps} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", () => {
    const { container } = render(<CreateGroupModal {...defaultProps} />);
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when modal content is clicked", () => {
    render(<CreateGroupModal {...defaultProps} />);
    fireEvent.click(screen.getByText("Create Curation Group"));
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it("adds topics via Enter key", () => {
    render(<CreateGroupModal {...defaultProps} />);
    const topicInput = screen.getByPlaceholderText("Add topic...");

    fireEvent.change(topicInput, { target: { value: "ai" } });
    fireEvent.keyDown(topicInput, { key: "Enter" });

    expect(screen.getByText("ai")).toBeInTheDocument();
    expect((topicInput as HTMLInputElement).value).toBe("");
  });

  it("adds topics via + button", () => {
    render(<CreateGroupModal {...defaultProps} />);
    const topicInput = screen.getByPlaceholderText("Add topic...");

    fireEvent.change(topicInput, { target: { value: "crypto" } });
    fireEvent.click(screen.getByText("+"));

    expect(screen.getByText("crypto")).toBeInTheDocument();
  });

  it("prevents duplicate topics", () => {
    render(<CreateGroupModal {...defaultProps} />);
    const topicInput = screen.getByPlaceholderText("Add topic...");

    fireEvent.change(topicInput, { target: { value: "ai" } });
    fireEvent.click(screen.getByText("+"));
    fireEvent.change(topicInput, { target: { value: "ai" } });
    fireEvent.click(screen.getByText("+"));

    // Should only appear once (the chip text)
    const chips = screen.getAllByText("ai");
    expect(chips).toHaveLength(1);
  });

  it("removes topic when x is clicked", () => {
    render(<CreateGroupModal {...defaultProps} />);
    const topicInput = screen.getByPlaceholderText("Add topic...");

    fireEvent.change(topicInput, { target: { value: "removeme" } });
    fireEvent.click(screen.getByText("+"));
    expect(screen.getByText("removeme")).toBeInTheDocument();

    // Click the × button
    fireEvent.click(screen.getByText("×"));
    expect(screen.queryByText("removeme")).toBeNull();
  });

  it("trims name whitespace", () => {
    render(<CreateGroupModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("e.g. AI Research");
    fireEvent.change(nameInput, { target: { value: "  Trimmed  " } });
    fireEvent.click(screen.getByText("Create Group"));

    expect(defaultProps.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Trimmed" }),
    );
  });

  it("normalizes topic to lowercase", () => {
    render(<CreateGroupModal {...defaultProps} />);
    const topicInput = screen.getByPlaceholderText("Add topic...");

    fireEvent.change(topicInput, { target: { value: "AI" } });
    fireEvent.click(screen.getByText("+"));

    expect(screen.getByText("ai")).toBeInTheDocument();
  });

  it("includes topics in onCreate payload", () => {
    render(<CreateGroupModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("e.g. AI Research");
    const topicInput = screen.getByPlaceholderText("Add topic...");

    fireEvent.change(nameInput, { target: { value: "My Group" } });

    fireEvent.change(topicInput, { target: { value: "ai" } });
    fireEvent.click(screen.getByText("+"));
    fireEvent.change(topicInput, { target: { value: "ml" } });
    fireEvent.click(screen.getByText("+"));

    fireEvent.click(screen.getByText("Create Group"));

    expect(defaultProps.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ topics: ["ai", "ml"] }),
    );
  });

  it("truncates name at 50 characters", () => {
    render(<CreateGroupModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("e.g. AI Research") as HTMLInputElement;
    const longName = "A".repeat(60);
    fireEvent.change(nameInput, { target: { value: longName } });
    expect(nameInput.value).toHaveLength(50);
  });
});
