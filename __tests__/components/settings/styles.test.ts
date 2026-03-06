/**
 * Tests for shared settings Tailwind class helpers.
 */
import { cardClass, sectionTitleClass, actionBtnClass, confirmBtnClass, cancelBtnClass, pillBtnClass } from "@/components/settings/styles";

describe("cardClass", () => {
  it("returns larger padding for desktop", () => {
    const cls = cardClass(false);
    expect(cls).toContain("p-5");
    expect(cls).toContain("mb-4");
  });

  it("returns smaller padding for mobile", () => {
    const cls = cardClass(true);
    expect(cls).toContain("p-4");
    expect(cls).toContain("mb-3");
  });

  it("defaults to desktop when mobile is undefined", () => {
    const cls = cardClass();
    expect(cls).toContain("p-5");
  });

  it("has card background and border", () => {
    const cls = cardClass();
    expect(cls).toContain("bg-card");
    expect(cls).toContain("border");
    expect(cls).toContain("rounded-lg");
  });
});

describe("sectionTitleClass", () => {
  it("has bold weight and tracking", () => {
    expect(sectionTitleClass).toContain("font-bold");
    expect(sectionTitleClass).toContain("tracking-");
  });

  it("has bottom margin", () => {
    expect(sectionTitleClass).toContain("mb-3");
  });
});

describe("actionBtnClass", () => {
  it("has cursor and transition", () => {
    expect(actionBtnClass).toContain("cursor-pointer");
    expect(actionBtnClass).toContain("transition-fast");
  });

  it("inherits font family", () => {
    expect(actionBtnClass).toContain("font-[inherit]");
  });
});

describe("confirmBtnClass", () => {
  it("uses amber/warning color", () => {
    expect(confirmBtnClass).toContain("text-amber-400");
    expect(confirmBtnClass).toContain("border-amber-400");
  });
});

describe("cancelBtnClass", () => {
  it("has transparent background", () => {
    expect(cancelBtnClass).toContain("bg-transparent");
  });

  it("has muted text color", () => {
    expect(cancelBtnClass).toContain("text-muted-foreground");
  });
});

describe("pillBtnClass", () => {
  it("returns highlighted style when active", () => {
    const cls = pillBtnClass(true);
    expect(cls).toContain("font-bold");
    expect(cls).toContain("text-cyan-400");
    expect(cls).toContain("bg-cyan-500");
  });

  it("returns muted style when inactive", () => {
    const cls = pillBtnClass(false);
    expect(cls).toContain("font-medium");
    expect(cls).toContain("text-muted-foreground");
    expect(cls).toContain("bg-transparent");
  });

  it("always has pointer cursor", () => {
    expect(pillBtnClass(true)).toContain("cursor-pointer");
    expect(pillBtnClass(false)).toContain("cursor-pointer");
  });

  it("always has transition", () => {
    expect(pillBtnClass(true)).toContain("transition-fast");
    expect(pillBtnClass(false)).toContain("transition-fast");
  });
});
