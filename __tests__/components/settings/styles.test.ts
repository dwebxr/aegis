/**
 * Tests for shared settings styles — verifies correct responsive behavior and active states.
 */
import { cardStyle, sectionTitle, actionBtnStyle, confirmBtnStyle, cancelBtnStyle, pillBtn } from "@/components/settings/styles";

describe("cardStyle", () => {
  it("returns larger padding for desktop", () => {
    const style = cardStyle(false);
    expect(style.padding).toBe(20); // space[5]
    expect(style.marginBottom).toBe(16); // space[4]
  });

  it("returns smaller padding for mobile", () => {
    const style = cardStyle(true);
    expect(style.padding).toBe(16); // space[4]
    expect(style.marginBottom).toBe(12); // space[3]
  });

  it("defaults to desktop when mobile is undefined", () => {
    const style = cardStyle();
    expect(style.padding).toBe(20);
  });

  it("has surface background and border", () => {
    const style = cardStyle();
    expect(style.background).toBe("var(--color-bg-surface)");
    expect(style.border).toBe("1px solid var(--color-border-default)");
    expect(style.borderRadius).toBe(16); // radii.lg
  });
});

describe("sectionTitle", () => {
  it("has correct font weight and letter spacing", () => {
    expect(sectionTitle.fontWeight).toBe(700);
    expect(sectionTitle.letterSpacing).toBe(0.3);
  });

  it("has bottom margin for spacing", () => {
    expect(sectionTitle.marginBottom).toBe(12); // space[3]
  });
});

describe("actionBtnStyle", () => {
  it("has pointer cursor and transition", () => {
    expect(actionBtnStyle.cursor).toBe("pointer");
    expect(actionBtnStyle.transition).toBe("all 0.15s ease"); // transitions.fast
  });

  it("inherits font family", () => {
    expect(actionBtnStyle.fontFamily).toBe("inherit");
  });
});

describe("confirmBtnStyle", () => {
  it("uses amber/warning color", () => {
    expect(String(confirmBtnStyle.color)).toContain("#fbbf24");
    expect(String(confirmBtnStyle.border)).toContain("#fbbf24");
  });
});

describe("cancelBtnStyle", () => {
  it("has transparent background", () => {
    expect(cancelBtnStyle.background).toBe("transparent");
  });

  it("has muted text color", () => {
    expect(cancelBtnStyle.color).toBe("var(--color-text-muted)");
  });
});

describe("pillBtn", () => {
  it("returns highlighted style when active", () => {
    const active = pillBtn(true);
    expect(active.fontWeight).toBe(700);
    expect(String(active.background)).toContain("#06b6d4");
    expect(String(active.color)).toContain("#22d3ee");
  });

  it("returns muted style when inactive", () => {
    const inactive = pillBtn(false);
    expect(inactive.fontWeight).toBe(500);
    expect(inactive.background).toBe("transparent");
    expect(inactive.color).toBe("var(--color-text-muted)");
  });

  it("always has pointer cursor", () => {
    expect(pillBtn(true).cursor).toBe("pointer");
    expect(pillBtn(false).cursor).toBe("pointer");
  });

  it("always has transition", () => {
    expect(pillBtn(true).transition).toBe("all 0.15s ease");
    expect(pillBtn(false).transition).toBe("all 0.15s ease");
  });
});
