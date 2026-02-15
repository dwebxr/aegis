import { createStatusEmitter } from "@/lib/utils/statusEmitter";

describe("createStatusEmitter", () => {
  it("calls listener immediately with initial status", () => {
    const { onStatusChange } = createStatusEmitter({ loading: false });
    const fn = jest.fn();
    onStatusChange(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ loading: false });
  });

  it("emits partial updates merged into current", () => {
    const { emit, onStatusChange } = createStatusEmitter({ a: 1, b: 2 });
    const fn = jest.fn();
    onStatusChange(fn);
    emit({ a: 10 });
    expect(fn).toHaveBeenLastCalledWith({ a: 10, b: 2 });
  });

  it("unsubscribe stops notifications", () => {
    const { emit, onStatusChange } = createStatusEmitter({ x: 0 });
    const fn = jest.fn();
    const unsub = onStatusChange(fn);
    unsub();
    emit({ x: 99 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("getStatus returns latest merged state", () => {
    const { emit, getStatus } = createStatusEmitter({ v: 0 });
    emit({ v: 5 });
    expect(getStatus()).toEqual({ v: 5 });
  });

  it("accumulates multiple consecutive emits", () => {
    const { emit, onStatusChange } = createStatusEmitter({ a: 0, b: 0, c: 0 });
    const fn = jest.fn();
    onStatusChange(fn);
    emit({ a: 1 });
    emit({ b: 2 });
    emit({ c: 3 });
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3 emits
    expect(fn).toHaveBeenLastCalledWith({ a: 1, b: 2, c: 3 });
  });

  it("multiple listeners all receive updates", () => {
    const { emit, onStatusChange } = createStatusEmitter({ v: 0 });
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    onStatusChange(fn1);
    onStatusChange(fn2);
    emit({ v: 42 });
    expect(fn1).toHaveBeenLastCalledWith({ v: 42 });
    expect(fn2).toHaveBeenLastCalledWith({ v: 42 });
  });

  it("listener that throws during emit propagates the error", () => {
    const { emit, onStatusChange } = createStatusEmitter({ v: 0 });
    const good = jest.fn();
    onStatusChange(good);
    // Register a listener that only throws on the second call (not during registration)
    let callCount = 0;
    const bad = jest.fn(() => { callCount++; if (callCount > 1) throw new Error("boom"); });
    onStatusChange(bad);
    expect(good).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1); // initial call (no throw)
    // emit: good gets called, then bad throws
    expect(() => emit({ v: 99 })).toThrow("boom");
    expect(good).toHaveBeenLastCalledWith({ v: 99 });
  });

  it("empty partial emit preserves state", () => {
    const { emit, getStatus } = createStatusEmitter({ a: 1, b: 2 });
    emit({});
    expect(getStatus()).toEqual({ a: 1, b: 2 });
  });

  it("unsubscribing one listener does not affect others", () => {
    const { emit, onStatusChange } = createStatusEmitter({ v: 0 });
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    const unsub1 = onStatusChange(fn1);
    onStatusChange(fn2);
    unsub1();
    emit({ v: 99 });
    expect(fn1).toHaveBeenCalledTimes(1); // only initial
    expect(fn2).toHaveBeenLastCalledWith({ v: 99 });
  });
});
