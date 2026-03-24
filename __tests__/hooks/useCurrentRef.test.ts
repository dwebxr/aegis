/**
 * @jest-environment jsdom
 */
/**
 * useCurrentRef — unit tests.
 * Verifies the ref always reflects the latest value across re-renders.
 */
import { renderHook } from "@testing-library/react";
import { useCurrentRef } from "@/hooks/useCurrentRef";

describe("useCurrentRef", () => {
  it("returns a ref with the initial value", () => {
    const { result } = renderHook(() => useCurrentRef(42));
    expect(result.current.current).toBe(42);
  });

  it("updates ref.current when value changes", () => {
    const { result, rerender } = renderHook(({ val }) => useCurrentRef(val), {
      initialProps: { val: "first" },
    });
    expect(result.current.current).toBe("first");

    rerender({ val: "second" });
    expect(result.current.current).toBe("second");
  });

  it("returns the same ref object across re-renders", () => {
    const { result, rerender } = renderHook(({ val }) => useCurrentRef(val), {
      initialProps: { val: 1 },
    });
    const refObj = result.current;

    rerender({ val: 2 });
    expect(result.current).toBe(refObj); // same reference
    expect(result.current.current).toBe(2);
  });

  it("works with object values", () => {
    const obj1 = { a: 1 };
    const obj2 = { a: 2 };
    const { result, rerender } = renderHook(({ val }) => useCurrentRef(val), {
      initialProps: { val: obj1 },
    });
    expect(result.current.current).toBe(obj1);

    rerender({ val: obj2 });
    expect(result.current.current).toBe(obj2);
  });

  it("works with null and undefined", () => {
    const { result, rerender } = renderHook(({ val }) => useCurrentRef(val), {
      initialProps: { val: null as string | null },
    });
    expect(result.current.current).toBeNull();

    rerender({ val: "defined" });
    expect(result.current.current).toBe("defined");

    rerender({ val: null });
    expect(result.current.current).toBeNull();
  });
});
