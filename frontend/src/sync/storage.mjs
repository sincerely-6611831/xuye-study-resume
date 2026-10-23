/** IndexedDB是浏览器的小型数据库；数据只属于当前浏览器，不等于已经同步到服务器。 */
let database;
async function open() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const r = indexedDB.open("study-resume-v1", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("records");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return database;
}
export const localKey = (userId, kind, id) => `${userId}:${kind}:${id}`;
async function transaction(mode, operation) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", mode);
    const r = operation(tx.objectStore("records"));
    tx.oncomplete = () => resolve(r.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("本机存储失败"));
  });
}
export const readLocal = (key) => transaction("readonly", (s) => s.get(key));
export const writeLocal = (key, value) =>
  transaction("readwrite", (s) => s.put(value, key));
export const removeLocal = (key) =>
  transaction("readwrite", (s) => s.delete(key));
export async function listPending(userId) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readonly");
    const r = tx.objectStore("records").openCursor();
    const values = [];
    r.onsuccess = () => {
      const cursor = r.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(`${userId}:pending:`))
        values.push({ key: cursor.key, ...cursor.value });
      cursor.continue();
    };
    tx.oncomplete = () => resolve(values);
    tx.onerror = () => reject(tx.error);
  });
}
