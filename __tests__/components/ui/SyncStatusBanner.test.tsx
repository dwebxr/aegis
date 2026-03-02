/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { SyncStatusBanner } from "@/components/ui/SyncStatusBanner";

// Mock useOnlineStatus
let mockOnline = true;
jest.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => mockOnline,
}));

// Mock queueSize
let mockQueueSize = 0;
jest.mock("@/lib/offline/actionQueue", () => ({
  queueSize: () => Promise.resolve(mockQueueSize),
}));

describe("SyncStatusBanner", () => {
  beforeEach(() => {
    mockOnline = true;
    mockQueueSize = 0;
  });

  it("renders nothing when online and no pending actions", async () => {
    const { container } = render(<SyncStatusBanner />);
    await waitFor(() => {
      expect(container.querySelector("[role='status']")).toBeNull();
    });
  });

  it("shows offline banner when offline", async () => {
    mockOnline = false;
    render(<SyncStatusBanner />);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/Offline/);
    });
  });

  it("shows pending count when offline with actions", async () => {
    mockOnline = false;
    mockQueueSize = 3;
    render(<SyncStatusBanner />);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("3 actions pending sync");
    });
  });

  it("shows syncing banner when online with pending", async () => {
    mockOnline = true;
    mockQueueSize = 2;
    render(<SyncStatusBanner />);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Syncing 2 pending actions");
    });
  });

  it("uses singular form for 1 action", async () => {
    mockOnline = false;
    mockQueueSize = 1;
    render(<SyncStatusBanner />);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("1 action pending sync");
    });
  });
});
