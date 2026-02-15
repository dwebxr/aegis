export interface StatusEmitter<T> {
  emit: (partial: Partial<T>) => void;
  onStatusChange: (listener: (status: T) => void) => () => void;
  getStatus: () => T;
}

export function createStatusEmitter<T>(initial: T): StatusEmitter<T> {
  let listeners: Array<(status: T) => void> = [];
  let current: T = { ...initial };

  return {
    emit(partial: Partial<T>): void {
      current = { ...current, ...partial };
      for (const listener of listeners) {
        listener(current);
      }
    },
    onStatusChange(listener: (status: T) => void): () => void {
      listeners.push(listener);
      listener(current);
      return () => {
        listeners = listeners.filter(l => l !== listener);
      };
    },
    getStatus(): T {
      return current;
    },
  };
}
