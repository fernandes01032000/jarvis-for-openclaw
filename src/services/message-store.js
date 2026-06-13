import { getEncryptionKey } from './auth.js';
import { encrypt, decrypt } from './encryption.js';

const DB_NAME = 'openclaw-pwa';
const STORE_NAME = 'messages';
const TOMBSTONE_STORE = 'tombstones';
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('seq', 'seq', { unique: false });
        store.createIndex('runId', 'runId', { unique: false });
      }
      if (!db.objectStoreNames.contains(TOMBSTONE_STORE)) {
        const tStore = db.createObjectStore(TOMBSTONE_STORE, { keyPath: 'key' });
        tStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // v2 -> v3: add runId index to existing store
      if (e.oldVersion >= 1 && e.oldVersion < 3) {
        const store = e.target.transaction.objectStore(STORE_NAME);
        if (!store.indexNames.contains('runId')) {
          store.createIndex('runId', 'runId', { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function isTombstoned(msg) {
  const db = await openDB();
  // Prefer runId (UUID, never repeats) then timestamp. Avoid seq — EventBuffer.nextSeq
  // resets to 1 on server restart, causing stale tombstones to block new messages.
  const tombstoneKey = msg.runId ? `run:${msg.runId}` : `ts:${msg.timestamp}`;
  return new Promise((resolve) => {
    const tx = db.transaction(TOMBSTONE_STORE, 'readonly');
    const store = tx.objectStore(TOMBSTONE_STORE);
    const req = store.get(tombstoneKey);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => resolve(false);
  });
}

export async function addMessage(msg) {
  const db = await openDB();
  
  // 1. Check Tombstones first
  if (await isTombstoned(msg)) {
    console.log(`[Store] Ignoring replayed message (tombstoned): ${msg.seq || msg.runId || msg.timestamp}`);
    return null;
  }

  // 2. Check for duplicates before adding
  const isDuplicate = await new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    // Fast path: use runId index for O(1) lookup when available
    if (msg.runId) {
      const idx = store.index('runId');
      const req = idx.get(msg.runId);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
      return;
    }

    // Fallback: timestamp+role scan for user messages (no runId)
    const tsIdx = store.index('timestamp');
    const req = tsIdx.openCursor(IDBKeyRange.only(msg.timestamp));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(false); return; }
      if (cursor.value.role === msg.role) { resolve(true); return; }
      cursor.continue();
    };
    req.onerror = () => resolve(false);
  });

  if (isDuplicate) return null;

  const key = await getEncryptionKey();
  const encryptedText = await encrypt(msg.text, key);
  const encryptedMsg = { ...msg, text: encryptedText, encrypted: true };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).add(encryptedMsg);
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function decryptMessages(messages) {
  const key = await getEncryptionKey();
  return Promise.all(messages.map(async m => {
    if (m.encrypted) {
      try {
        return { ...m, text: await decrypt(m.text, key), encrypted: false };
      } catch (err) {
        console.error('Failed to decrypt message:', err);
        return { ...m, text: '[DECRYPTION FAILED]', encrypted: false };
      }
    }
    return m;
  }));
}

export async function getByCategory(category, limit = 100) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const index = tx.objectStore(STORE_NAME).index('category');
    const req = index.openCursor(category, 'prev');
    const results = [];
    req.onsuccess = async () => {
      const cursor = req.result;
      if (cursor && results.length < limit) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        const decrypted = await decryptMessages(results.reverse());
        resolve(decrypted);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLatest(limit = 100) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor(null, 'prev');
    const results = [];
    req.onsuccess = async () => {
      const cursor = req.result;
      if (cursor && results.length < limit) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        const decrypted = await decryptMessages(results.reverse());
        resolve(decrypted);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function markSeen(id) {
  if (!id) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      const msg = req.result;
      if (msg) {
        msg.seen = true;
        store.put(msg);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteMessage(id, timestamp = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, TOMBSTONE_STORE], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const tStore = tx.objectStore(TOMBSTONE_STORE);

    const finalizeDeletion = (msg) => {
      if (msg) {
        // Record tombstone using multiple potential identifiers
        const keys = [];
        if (msg.runId) keys.push(`run:${msg.runId}`);
        keys.push(`ts:${msg.timestamp}`);

        keys.forEach(key => {
          tStore.put({ key, timestamp: Date.now() });
        });
        
        if (msg.id) store.delete(msg.id);
      } else if (timestamp) {
        // If message not found but we have a timestamp, tombstone the timestamp
        tStore.put({ key: `ts:${timestamp}`, timestamp: Date.now() });
      }
    };

    if (id) {
      const getReq = store.get(id);
      getReq.onsuccess = () => finalizeDeletion(getReq.result);
    } else if (timestamp) {
      // Find by timestamp if id is missing
      const index = store.index('timestamp');
      const getReq = index.get(timestamp);
      getReq.onsuccess = () => finalizeDeletion(getReq.result);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearByCategory(category) {
  const db = await openDB();
  console.log(`[Store] Clearing category: ${category}`);
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, TOMBSTONE_STORE], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const tStore = tx.objectStore(TOMBSTONE_STORE);
    
    const tombstone = (msg) => {
      const keys = [];
      if (msg.runId) keys.push(`run:${msg.runId}`);
      keys.push(`ts:${msg.timestamp}`);
      keys.forEach(key => tStore.put({ key, timestamp: Date.now() }));
    };

    if (category === 'chat') {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const msg = cursor.value;
          if (msg.category !== 'alert' && msg.category !== 'report') {
            tombstone(msg);
            cursor.delete();
          }
          cursor.continue();
        }
      };
    } else {
      const index = store.index('category');
      const req = index.openCursor(category);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          tombstone(cursor.value);
          cursor.delete();
          cursor.continue();
        }
      };
    }
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, TOMBSTONE_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(TOMBSTONE_STORE).clear(); // Also clear tombstones if user wants total wipe
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

