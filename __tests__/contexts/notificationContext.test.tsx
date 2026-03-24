/**
 * @jest-environment jsdom
 */
/**
 * NotificationContext — unit tests.
 * Tests addNotification / removeNotification via the provider,
 * and verifies NotificationToast receives the right props.
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { NotificationProvider, useNotify } from "@/contexts/NotificationContext";

/* ── mock child hooks so we control them directly ── */
let mockNotifications: Array<{ id: number; text: string; type: string }> = [];
let mockAdd: jest.Mock;
let mockRemove: jest.Mock;
let mockMobile = false;

jest.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({
    notifications: mockNotifications,
    addNotification: mockAdd,
    removeNotification: mockRemove,
  }),
}));

jest.mock("@/hooks/useWindowSize", () => ({
  useWindowSize: () => ({ width: mockMobile ? 400 : 1024, mobile: mockMobile, tablet: false }),
}));

jest.mock("@/components/ui/NotificationToast", () => ({
  NotificationToast: (props: { notifications: unknown[]; mobile: boolean; onDismiss: unknown }) => (
    <div data-testid="toast" data-mobile={String(props.mobile)} data-count={props.notifications.length} />
  ),
}));

function Consumer() {
  const { addNotification, removeNotification } = useNotify();
  return (
    <>
      <button data-testid="add" onClick={() => addNotification("hello", "info")} />
      <button data-testid="remove" onClick={() => removeNotification(1)} />
    </>
  );
}

beforeEach(() => {
  mockNotifications = [];
  mockAdd = jest.fn();
  mockRemove = jest.fn();
  mockMobile = false;
});

describe("NotificationContext", () => {
  it("provides addNotification and removeNotification to children", () => {
    render(
      <NotificationProvider><Consumer /></NotificationProvider>,
    );
    act(() => { screen.getByTestId("add").click(); });
    expect(mockAdd).toHaveBeenCalledWith("hello", "info");

    act(() => { screen.getByTestId("remove").click(); });
    expect(mockRemove).toHaveBeenCalledWith(1);
  });

  it("passes notifications and mobile flag to NotificationToast", () => {
    mockNotifications = [{ id: 1, text: "a", type: "info" }];
    mockMobile = true;
    render(
      <NotificationProvider><Consumer /></NotificationProvider>,
    );
    const toast = screen.getByTestId("toast");
    expect(toast.dataset.count).toBe("1");
    expect(toast.dataset.mobile).toBe("true");
  });

  it("renders toast with zero notifications", () => {
    render(
      <NotificationProvider><Consumer /></NotificationProvider>,
    );
    expect(screen.getByTestId("toast").dataset.count).toBe("0");
  });

  it("useNotify returns no-ops outside provider (default context)", () => {
    // Should not throw when called outside provider
    function Orphan() {
      const { addNotification, removeNotification } = useNotify();
      return <div data-testid="orphan" data-add={typeof addNotification} data-remove={typeof removeNotification} />;
    }
    render(<Orphan />);
    const el = screen.getByTestId("orphan");
    expect(el.dataset.add).toBe("function");
    expect(el.dataset.remove).toBe("function");
  });
});
