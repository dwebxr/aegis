import { calculateMutualFollows } from "@/lib/wot/graph";
import type { WoTNode } from "@/lib/wot/types";

describe("calculateMutualFollows — edge cases", () => {
  function makeNodes(data: Array<{ pk: string; follows: string[]; hop: number }>): Map<string, WoTNode> {
    const nodes = new Map<string, WoTNode>();
    for (const d of data) {
      nodes.set(d.pk, { pubkey: d.pk, follows: d.follows, hopDistance: d.hop, mutualFollows: 0 });
    }
    return nodes;
  }

  it("handles empty nodes map", () => {
    const nodes = new Map<string, WoTNode>();
    calculateMutualFollows(nodes, "user");
    expect(nodes.size).toBe(0);
  });

  it("handles user not in nodes map", () => {
    const nodes = makeNodes([
      { pk: "a", follows: ["b"], hop: 1 },
      { pk: "b", follows: ["a"], hop: 1 },
    ]);
    // Should not throw
    calculateMutualFollows(nodes, "nonexistent");
    expect(nodes.get("a")!.mutualFollows).toBe(0);
  });

  it("handles user with no follows", () => {
    const nodes = makeNodes([
      { pk: "user", follows: [], hop: 0 },
      { pk: "a", follows: ["user"], hop: 1 },
    ]);
    calculateMutualFollows(nodes, "user");
    // user follows nobody → nobody can have mutual follows with user
    expect(nodes.get("a")!.mutualFollows).toBe(0);
  });

  it("counts direct mutual follows correctly", () => {
    const nodes = makeNodes([
      { pk: "user", follows: ["a", "b"], hop: 0 },
      { pk: "a", follows: ["c"], hop: 1 },
      { pk: "b", follows: ["c"], hop: 1 },
      { pk: "c", follows: [], hop: 2 },
    ]);
    calculateMutualFollows(nodes, "user");
    // c is followed by a and b; user follows both a and b → c.mutualFollows = 2
    expect(nodes.get("c")!.mutualFollows).toBe(2);
  });

  it("does not count user in their own mutual follows", () => {
    const nodes = makeNodes([
      { pk: "user", follows: ["a"], hop: 0 },
      { pk: "a", follows: ["user"], hop: 1 },
    ]);
    calculateMutualFollows(nodes, "user");
    // 'a' is followed by 'user' (who is NOT in userDirectFollows since it's user themselves)
    // Wait: userDirectFollows = Set(["a"])
    // followers of "a" = Set(["user"])
    // "user" is in userDirectFollows? No, "a" is in userDirectFollows
    // We check: for each follower of 'a' ("user"), is "user" in userDirectFollows (["a"])? No.
    expect(nodes.get("a")!.mutualFollows).toBe(0);
  });

  it("handles self-follows (user follows themselves)", () => {
    const nodes = makeNodes([
      { pk: "user", follows: ["user", "a"], hop: 0 },
      { pk: "a", follows: ["user"], hop: 1 },
    ]);
    calculateMutualFollows(nodes, "user");
    // followers of "a" = ["user"]
    // Is "user" in userDirectFollows (["user", "a"])? Yes!
    expect(nodes.get("a")!.mutualFollows).toBe(1);
  });

  it("handles circular follows", () => {
    const nodes = makeNodes([
      { pk: "user", follows: ["a"], hop: 0 },
      { pk: "a", follows: ["b"], hop: 1 },
      { pk: "b", follows: ["a"], hop: 2 },
    ]);
    calculateMutualFollows(nodes, "user");
    // followers of "b" = ["a"]; "a" is in userDirectFollows → b.mutual = 1
    expect(nodes.get("b")!.mutualFollows).toBe(1);
    // followers of "a" = ["b"]; "b" is NOT in userDirectFollows → a.mutual = 0
    expect(nodes.get("a")!.mutualFollows).toBe(0);
  });

  it("handles large network (500 nodes)", () => {
    const data: Array<{ pk: string; follows: string[]; hop: number }> = [
      { pk: "user", follows: Array.from({ length: 100 }, (_, i) => `f${i}`), hop: 0 },
    ];
    for (let i = 0; i < 500; i++) {
      data.push({ pk: `f${i}`, follows: [`target`], hop: 1 });
    }
    data.push({ pk: "target", follows: [], hop: 2 });

    const nodes = makeNodes(data);
    calculateMutualFollows(nodes, "user");

    // target is followed by f0..f499; user follows f0..f99
    // mutual follows = 100 (f0..f99 are in userDirectFollows and follow target)
    expect(nodes.get("target")!.mutualFollows).toBe(100);
  });

  it("handles nodes with no followers", () => {
    const nodes = makeNodes([
      { pk: "user", follows: ["a", "b"], hop: 0 },
      { pk: "a", follows: [], hop: 1 },
      { pk: "b", follows: [], hop: 1 },
      { pk: "c", follows: [], hop: 2 },
    ]);
    calculateMutualFollows(nodes, "user");
    // Nobody follows c → mutualFollows = 0
    expect(nodes.get("c")!.mutualFollows).toBe(0);
    // Nobody follows a → mutualFollows = 0
    expect(nodes.get("a")!.mutualFollows).toBe(0);
  });
});
