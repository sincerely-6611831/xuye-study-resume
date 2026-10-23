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
/** 同一次读写事务内检查并修改，避免两个标签页都用旧版本覆盖彼此。 */
export async function updateLocal(key, transform) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    const store = tx.objectStore("records");
    let result, failure;
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        result = transform(request.result);
        store.put(result, key);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () =>
      reject(failure || tx.error || new Error("本机存储失败"));
  });
}
export async function listLocal(prefix) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readonly");
    const values = [];
    const r = tx.objectStore("records").openCursor();
    r.onsuccess = () => {
      const cur = r.result;
      if (cur) {
        if (String(cur.key).startsWith(prefix)) values.push(cur.value);
        cur.continue();
      }
    };
    tx.oncomplete = () => resolve(values);
    tx.onerror = () => reject(tx.error);
  });
}
/** 多条记录同事务替换：先保留副本、再接收远端，不能夹入另一个标签页的写入。 */
export async function atomicRecords(keys, transform) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite"),
      store = tx.objectStore("records");
    const values = [];
    let remaining = keys.length,
      result,
      failure;
    keys.forEach((key, index) => {
      const r = store.get(key);
      r.onsuccess = () => {
        values[index] = r.result;
        if (--remaining === 0) {
          try {
            const change = transform(values);
            result = change.result;
            for (const [k, v] of change.writes || []) store.put(v, k);
            for (const k of change.deletes || []) store.delete(k);
          } catch (e) {
            failure = e;
            tx.abort();
          }
        }
      };
    });
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () =>
      reject(failure || tx.error || new Error("本机事务失败"));
  });
}
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
