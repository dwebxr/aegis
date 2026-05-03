const DB_NAME = "aegis-offline-queue";
const DB_VERSION = 1;
const STORE_NAME = "pending-actions";

/** saveEvaluation re-runs `actor.saveEvaluation(toICEvaluation(item))` against the
 *  caller's local content list. Only the item id is stored — the latest item state
 *  is fetched from the in-memory cache at replay time so the user's most recent
 *  validated/flagged toggles aren't overwritten by a stale snapshot. */
export interface SaveEvaluationPayload {
  itemId: string;
}

/** updateEvaluation toggles validated/flagged flags on an existing IC evaluation.
 *  Captured at enqueue time because the canonical state lives on IC, not in the
 *  local cache. */
export interface UpdateEvaluationPayload {
  id: string;
  validated: boolean;
  flagged: boolean;
}

export type QueuedActionPayloadFor<T extends QueuedActionType> =
  T extends "saveEvaluation" ? SaveEvaluationPayload :
  T extends "updateEvaluation" ? UpdateEvaluationPayload :
  never;

export type QueuedActionType = "saveEvaluation" | "updateEvaluation";

export type QueuedAction =
  | (QueuedActionBase & { type: "saveEvaluation"; payload: SaveEvaluationPayload })
  | (QueuedActionBase & { type: "updateEvaluation"; payload: UpdateEvaluationPayload });

interface QueuedActionBase {
  id?: number; // auto-incremented by IndexedDB
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

export async function enqueueAction<T extends QueuedActionType>(
  type: T,
  payload: QueuedActionPayloadFor<T>,
): Promise<void> {
  await withDB("readwrite", store => {
    // The discriminated union narrows fine for callers, but TS can't prove the
    // generic here aligns with one branch — cast at the IDB boundary.
    store.add({ type, payload, createdAt: Date.now(), retries: 0 } as Omit<QueuedAction, "id">);
  });
}

export function dequeueAll(): Promise<QueuedAction[]> {
  return withDB("readonly", store => store.getAll());
}

export function removeAction(id: number): Promise<void> {
  return withDB("readwrite", store => { store.delete(id); });
}

export function incrementRetries(id: number): Promise<void> {
  return openDB().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const action = getReq.result as QueuedAction | undefined;
      if (action) {
        action.retries += 1;
        store.put(action);
      }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export function clearQueue(): Promise<void> {
  return withDB("readwrite", store => { store.clear(); });
}

export function queueSize(): Promise<number> {
  return withDB("readonly", store => store.count());
}
