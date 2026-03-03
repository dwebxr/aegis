import { test, expect } from "../fixtures/base";

test.describe("Settings Tab — Sub-tabs", () => {
  test("shows Settings heading", async ({ authSettingsPage }) => {
    await expect(authSettingsPage.heading).toBeVisible();
    await expect(authSettingsPage.heading).toContainText("Settings");
  });

  test("shows 5 sub-tab buttons", async ({ authSettingsPage }) => {
    const tabs = ["general", "agent", "feeds", "data", "account"] as const;
    for (const tab of tabs) {
      await expect(authSettingsPage.subTabButton(tab)).toBeVisible();
    }
  });

  test("General sub-tab shows Appearance section", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("general");
    await expect(authSettingsPage.page.getByText("Appearance")).toBeVisible();
  });

  test("switching to Agent sub-tab shows agent configuration", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("agent");
    await expect(authSettingsPage.page.getByText("Agent Preferences")).toBeVisible();
  });

  test("switching to Feeds sub-tab shows filter mode section", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("feeds");
    await expect(authSettingsPage.page.getByText(/filter mode|scoring/i).first()).toBeVisible();
  });

  test("switching to Data sub-tab shows data management", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("data");
    await expect(authSettingsPage.page.getByText("Data Management")).toBeVisible();
  });

  test("switching to Account sub-tab shows account settings", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("account");
    await expect(authSettingsPage.page.getByText("Principal:")).toBeVisible();
  });
});

test.describe("Settings — General Interactions", () => {
  test("theme toggle button is visible and changes aria-label on click", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("general");
    const toggle = authSettingsPage.page.getByTestId("aegis-settings-theme-toggle");
    await expect(toggle).toBeVisible();
    const labelBefore = await toggle.getAttribute("aria-label");
    await toggle.click();
    // After click, aria-label should change (Switch to light ↔ Switch to dark)
    const labelAfter = await toggle.getAttribute("aria-label");
    expect(labelAfter).not.toBe(labelBefore);
  });

  test("theme mode text changes after toggle click", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("general");
    const toggle = authSettingsPage.page.getByTestId("aegis-settings-theme-toggle");
    // Find the mode text sibling (shows "Dark mode" or "Light mode")
    const modeText = authSettingsPage.page.getByText(/mode$/);
    const textBefore = await modeText.textContent();
    await toggle.click();
    const textAfter = await modeText.textContent();
    expect(textAfter).not.toBe(textBefore);
  });

  test("Push Notifications section is visible", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("general");
    await expect(authSettingsPage.page.getByText("Push Notifications").first()).toBeVisible();
  });
});

test.describe("Settings — Agent Interactions", () => {
  test("Agent sub-tab shows interest, blocked author, and burn pattern inputs", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("agent");
    await expect(authSettingsPage.page.getByTestId("aegis-settings-interest-input")).toBeVisible();
    await expect(authSettingsPage.page.getByTestId("aegis-settings-blocked-author-input")).toBeVisible();
    await expect(authSettingsPage.page.getByTestId("aegis-settings-burn-pattern-input")).toBeVisible();
  });

  test("quality threshold slider is visible", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("agent");
    await expect(authSettingsPage.page.getByTestId("aegis-settings-quality-threshold")).toBeVisible();
  });
});

test.describe("Settings — Feeds Interactions", () => {
  test("Feeds sub-tab shows API key input and Save button", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("feeds");
    await expect(authSettingsPage.page.getByTestId("aegis-settings-apikey-input")).toBeVisible();
    await expect(authSettingsPage.page.getByTestId("aegis-settings-apikey-save")).toBeVisible();
  });

  test("Save API key button is disabled when input is empty", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("feeds");
    await expect(authSettingsPage.page.getByTestId("aegis-settings-apikey-save")).toBeDisabled();
  });

  test("Ollama and WebLLM toggle buttons are visible", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("feeds");
    await expect(authSettingsPage.page.getByTestId("aegis-settings-ollama-toggle")).toBeVisible();
    await expect(authSettingsPage.page.getByTestId("aegis-settings-webllm-toggle")).toBeVisible();
  });
});

test.describe("Settings — Data Interactions", () => {
  test("Data sub-tab shows Export section with no-content message", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("data");
    await expect(authSettingsPage.page.getByText("Export", { exact: true })).toBeVisible();
    await expect(authSettingsPage.page.getByText("No content to export yet")).toBeVisible();
  });

  test("Clear Cache and Reset Preferences buttons are visible", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("data");
    await expect(authSettingsPage.page.getByTestId("aegis-settings-clear-cache")).toBeVisible();
    await expect(authSettingsPage.page.getByTestId("aegis-settings-reset-prefs")).toBeVisible();
  });

  test("Data Management section has explanatory text", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("data");
    await expect(authSettingsPage.page.getByText("Data Management")).toBeVisible();
    await expect(authSettingsPage.page.getByText(/dedup hashes/)).toBeVisible();
  });
});

test.describe("Settings — Account Interactions", () => {
  test("Account sub-tab shows Principal and Copy button for authenticated user", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("account");
    await expect(authSettingsPage.page.getByText("Principal:")).toBeVisible();
    await expect(authSettingsPage.page.getByTestId("aegis-settings-copy-principal")).toBeVisible();
  });

  test("Danger Zone delete section is visible", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("account");
    await expect(authSettingsPage.page.getByTestId("aegis-settings-delete-data")).toBeVisible();
  });

  test("Copy Principal button shows 'Copy' text", async ({ authSettingsPage }) => {
    await authSettingsPage.switchSubTab("account");
    const copyBtn = authSettingsPage.page.getByTestId("aegis-settings-copy-principal");
    await expect(copyBtn).toContainText("Copy");
  });
});

test.describe("Settings — Full Navigation", () => {
  test("navigating through all sub-tabs renders without errors", async ({ authSettingsPage }) => {
    const expectedContent: Record<string, string> = {
      general: "Appearance",
      agent: "Agent Preferences",
      feeds: "Filter Mode",
      data: "Data Management",
      account: "Account",
    };
    for (const [tab, text] of Object.entries(expectedContent)) {
      await authSettingsPage.switchSubTab(tab as "general" | "agent" | "feeds" | "data" | "account");
      await expect(authSettingsPage.page.getByText(text).first()).toBeVisible();
    }
  });
});
