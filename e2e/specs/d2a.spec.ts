import { test, expect } from "../fixtures/base";

test.describe("D2A Tab — Layout", () => {
  test("shows D2A Activity heading", async ({ authD2APage }) => {
    await expect(authD2APage.heading).toBeVisible();
    await expect(authD2APage.heading).toContainText("D2A Activity");
  });

  test("shows agent status subtitle with enable prompt", async ({ authD2APage }) => {
    await expect(authD2APage.status).toBeVisible();
    // D2A agent is disabled by default → status shows enable prompt
    await expect(authD2APage.status).toContainText(/Enable D2A Agent|peers|active/i);
  });

  test("shows 5 sub-tab buttons", async ({ authD2APage }) => {
    const tabs = ["exchanges", "published", "matches", "peers", "groups"] as const;
    for (const tab of tabs) {
      await expect(authD2APage.subTabButton(tab)).toBeVisible();
    }
  });
});

test.describe("D2A Tab — Sub-tab Navigation", () => {
  test("Exchanges tab shows empty state with specific title", async ({ authD2APage }) => {
    // Agent not active in tests → "Start exchanging content" empty state
    await expect(authD2APage.page.getByText(/Start exchanging content|Waiting for exchanges/)).toBeVisible();
  });

  test("switching to Published sub-tab shows description and empty state", async ({ authD2APage }) => {
    await authD2APage.switchSubTab("published");
    // Description always present above list/empty-state
    await expect(authD2APage.page.getByText(/validated as quality/)).toBeVisible();
    // Empty state title when no validated items
    await expect(authD2APage.page.getByText("No published signals yet")).toBeVisible();
  });

  test("switching to Matches sub-tab shows match content or loading state", async ({ authD2APage }) => {
    await authD2APage.switchSubTab("matches");
    // IC canister mocked with empty CBOR → matches load as empty or null initially
    // Could show: "No match records yet" after load, or nothing while loading, or "Login required"
    const content = authD2APage.page.getByText(/No match records yet|Login required|Loading match records/);
    // Wait for stable state — loading finishes quickly with mocked IC
    await expect(content.first()).toBeVisible({ timeout: 5_000 });
  });

  test("switching to Peers sub-tab shows 'No peers yet' empty state", async ({ authD2APage }) => {
    await authD2APage.switchSubTab("peers");
    await expect(authD2APage.page.getByText("No peers yet")).toBeVisible();
  });

  test("switching to Groups sub-tab shows Curation Groups heading", async ({ authD2APage }) => {
    await authD2APage.switchSubTab("groups");
    await expect(authD2APage.page.getByText("Curation Groups").first()).toBeVisible();
  });

  test("navigating through all 5 sub-tabs does not crash", async ({ authD2APage }) => {
    const tabs = ["exchanges", "published", "matches", "peers", "groups"] as const;
    for (const tab of tabs) {
      await authD2APage.switchSubTab(tab);
      // After each switch D2A heading must persist
      await expect(authD2APage.heading).toBeVisible();
    }
  });
});

test.describe("D2A Tab — Empty State Actions", () => {
  test("Exchanges empty state has Enable in Settings button", async ({ authD2APage }) => {
    // Agent inactive → "Start exchanging content" with Settings link
    await expect(authD2APage.page.getByText(/Start exchanging content/)).toBeVisible();
    const enableBtn = authD2APage.page.getByRole("button", { name: /Enable in Settings/i });
    await expect(enableBtn).toBeVisible();
  });

  test("Peers empty state has Enable in Settings button", async ({ authD2APage }) => {
    await authD2APage.switchSubTab("peers");
    await expect(authD2APage.page.getByText("No peers yet")).toBeVisible();
    const enableBtn = authD2APage.page.getByRole("button", { name: /Enable in Settings/i });
    await expect(enableBtn).toBeVisible();
  });

  test("Published empty state has Start Evaluating button", async ({ authD2APage }) => {
    await authD2APage.switchSubTab("published");
    await expect(authD2APage.page.getByText("No published signals yet")).toBeVisible();
    const evalBtn = authD2APage.page.getByRole("button", { name: /Start Evaluating/i });
    await expect(evalBtn).toBeVisible();
  });

  test("D2A heading persists across sub-tab switches", async ({ authD2APage }) => {
    await authD2APage.switchSubTab("published");
    await expect(authD2APage.heading).toBeVisible();
    await authD2APage.switchSubTab("peers");
    await expect(authD2APage.heading).toBeVisible();
  });
});
