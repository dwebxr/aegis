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
  // Principal (text) that enqueued the action. Used to scope dequeue so a
  // different logged-in user can't replay another user's queued saves.
  // null = anonymous / pre-scoping legacy entry (dropped on dequeue).
  principal: string | null;
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
  principal: string | null,
): Promise<void> {
  await withDB("readwrite", store => {
    // The discriminated union narrows fine for callers, but TS can't prove the
    // generic here aligns with one branch — cast at the IDB boundary.
    store.add({ type, payload, createdAt: Date.now(), retries: 0, principal } as Omit<QueuedAction, "id">);
  });
}

/** Returns queued actions for the given principal only. Every other entry (a
 *  different principal, or a legacy/pre-scoping entry with no principal) is LEFT IN
 *  PLACE — not returned and NOT deleted — so it survives until its owner logs back in
 *  on this device. The principal filter here already prevents cross-account replay, so
 *  the previous behaviour of deleting other principals' entries only caused silent
 *  data loss on shared devices (and returning legacy no-principal entries to whoever
 *  logged in first would mis-attribute them). Called with `principal === null`
 *  (logged-out) is a no-op so the queue isn't wiped during transient unauth states. */
export function dequeueAll(principal: string | null): Promise<QueuedAction[]> {
  if (principal === null) return Promise.resolve([]);
  return openDB().then(db => new Promise<QueuedAction[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    const matched: QueuedAction[] = [];
    req.onsuccess = () => {
      for (const a of (req.result as QueuedAction[]) ?? []) {
        if (a.principal === principal) matched.push(a);
      }
    };
    tx.oncomplete = () => { db.close(); resolve(matched); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
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

/** Number of pending actions. Pass a principal to count only THAT principal's actions
 *  (what the current user will actually drain) — required now that dequeueAll leaves
 *  other principals' entries in place, so a raw total would show one user a permanent
 *  "pending sync" badge for another user's preserved actions. `null`/"" → 0 (logged
 *  out drains nothing); `undefined` → total across all principals (legacy callers). */
export function queueSize(principal?: string | null): Promise<number> {
  if (principal === undefined) return withDB("readonly", store => store.count());
  if (principal === null || principal === "") return Promise.resolve(0);
  return openDB().then(db => new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    let n = 0;
    req.onsuccess = () => {
      for (const a of (req.result as QueuedAction[]) ?? []) {
        if (a.principal === principal) n++;
      }
    };
    tx.oncomplete = () => { db.close(); resolve(n); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}
