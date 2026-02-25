/**
 * IndexedDB-backed queue for IC canister operations that fail during offline periods.
 * Operations are stored and replayed when connectivity resumes.
 */

const DB_NAME = "aegis-offline-queue";
const DB_VERSION = 1;
const STORE_NAME = "pending-actions";

export type QueuedActionType = "saveEvaluation" | "updateEvaluation";

export interface QueuedAction {
  id?: number; // auto-incremented by IndexedDB
  type: QueuedActionType;
  payload: unknown;
  createdAt: number;
  retries: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run a transactional operation against the store, auto-closing the DB on completion. */
function withDB<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined as T); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export function enqueueAction(type: QueuedActionType, payload: unknown): Promise<void> {
  return withDB("readwrite", store => {
    store.add({ type, payload, createdAt: Date.now(), retries: 0 } satisfies Omit<QueuedAction, "id">);
  });
}

export function dequeueAll(): Promise<QueuedAction[]> {
  return withDB("readonly", store => store.getAll());
}

export function removeAction(id: number): Promise<void> {
  return withDB("readwrite", store => { store.delete(id); });
}

export function incrementRetries(id: number): Promise<void> {
  return withDB("readwrite", store => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const action = getReq.result as QueuedAction | undefined;
      if (action) {
        action.retries += 1;
        store.put(action);
      }
    };
  });
}

export function clearQueue(): Promise<void> {
  return withDB("readwrite", store => { store.clear(); });
}

export function queueSize(): Promise<number> {
  return withDB("readonly", store => store.count());
}
