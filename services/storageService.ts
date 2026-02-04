import { UserPreferences } from '../types';

const DB_NAME = 'GeminiFaceArchitectDB';
const DB_VERSION = 1;
const STORE_NAME = 'preferences';
const KEY = 'user_settings';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    
    request.onsuccess = () => resolve(request.result);
  });
};

// Merges new preferences with existing ones to prevent data loss
export const updatePreferences = async (partialPrefs: Partial<UserPreferences>): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const getReq = store.get(KEY);
      
      getReq.onsuccess = () => {
        const current = (getReq.result as UserPreferences) || {};
        const updated = { ...current, ...partialPrefs };
        
        const putReq = store.put(updated, KEY);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.error("IndexedDB Update Error:", err);
    throw err;
  }
};

export const loadPreferences = async (): Promise<UserPreferences | null> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(KEY);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as UserPreferences || null);
    });
  } catch (err) {
    console.error("IndexedDB Load Error:", err);
    return null;
  }
};