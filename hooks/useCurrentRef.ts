import { useRef } from "react";

/** Keeps a ref always in sync with the latest value. Useful for avoiding stale closures in callbacks. */
export function useCurrentRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
