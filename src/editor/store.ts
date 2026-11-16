// The unsent change, kept on this device so a reload, an update or a closed app does
// not lose it. IndexedDB, because a photo is bytes. One record per site address, so
// a pull request preview and the live editor never mix their drafts. Every call
// answers false or null when the browser has no storage (a private window).
import type { Photo } from "../render";
import type { Change } from "./changes";

export type SavedDraft = { changes: Change[]; photos: Record<string, Photo>; saved_at: string };
const DB = "robins-editor";
const STORE = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(req.error);
  });
}
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((done, fail) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => done(req.result);
      tx.onerror = tx.onabort = () => fail(tx.error);
    });
  } finally {
    db.close();
  }
}

export const loadDraft = (key: string): Promise<SavedDraft | null> => run<SavedDraft | undefined>("readonly", (s) => s.get(key)).then((v) => v ?? null, () => null);
/** An empty draft removes the record. True when the device now holds what was asked. */
export const saveDraft = (key: string, draft: SavedDraft | null): Promise<boolean> =>
  run<unknown>("readwrite", (s) => (draft && draft.changes.length ? s.put(draft, key) : s.delete(key)) as IDBRequest<unknown>).then(() => true, () => false);
