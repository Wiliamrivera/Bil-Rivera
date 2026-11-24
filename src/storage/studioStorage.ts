import { PracticeTrack, Setlist, StudioSettings } from '../types/studio';

const DB_NAME = 'riveraVSAudioDB';
const LEGACY_DB_NAME = 'riffForgeAudioDB';
const DB_VERSION = 2;
const STORE_AUDIO = 'audioFiles';
const STORE_META = 'meta';
const DB_MIGRATED_FLAG = 'rivera_vs_db_migrated_v1';

const KEYS = {
  tracks: 'rivera_vs_tracks_v1',
  setlists: 'rivera_vs_setlists_v1',
  settings: 'rivera_vs_settings_v1',
  activeTrackId: 'rivera_vs_active_track_v1',
  activeSetlistId: 'rivera_vs_active_setlist_v1',
  lastFolderName: 'rivera_vs_last_folder_v1',
};

const LEGACY_KEYS = {
  tracks: 'riffforge_tracks_v1',
  setlists: 'riffforge_setlists_v1',
  settings: 'riffforge_settings_v1',
  activeTrackId: 'riffforge_active_track_v1',
  activeSetlistId: 'riffforge_active_setlist_v1',
  lastFolderName: 'riffforge_last_folder_v1',
};

export const APP_VERSION = 'v2.0.0';
export const DEFAULT_HEADER_LOGO = '/logo-vs-v12.png';

export const DEFAULT_SETTINGS: StudioSettings = {
  language: 'pt',
  theme: 'dark',
  colorPalette: 'amber',
  defaultCountInBars: 0,
  clickSound: 'stick',
  metronomeEnabled: false,
  metronomeVolume: 0,
  snapMode: 'off',
  autoRewindOnPause: 'none',
  speedStepPercent: 5,
  seekStepSeconds: 5,
  stageMode: true,
  showRehearsalTools: false,
  autoAdvance: false,
  swapLR: false,
  headerLogoDataUrl: DEFAULT_HEADER_LOGO,
  headerBrandMode: 'both',
  autoStepUpEnabled: false,
  autoStepUpIncrement: 5,
  autoStepUpEveryLoops: 2,
  autoStepUpTarget: 100,
  loopGapSeconds: 0,
  followPlayhead: true,
};

function readStorageWithLegacyMigration(newKey: string, legacyKey: string): string | null {
  try {
    const current = localStorage.getItem(newKey);
    if (current !== null) return current;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      try {
        localStorage.setItem(newKey, legacy);
      } catch {
        // ignore quota errors during migration
      }
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;
let dbMigrationPromise: Promise<void> | null = null;

async function hasLegacyAudioDatabase(): Promise<boolean> {
  try {
    if (localStorage.getItem(DB_MIGRATED_FLAG) === '1') return false;
  } catch {
    return false;
  }

  try {
    if (typeof indexedDB.databases === 'function') {
      const list = await indexedDB.databases();
      return list.some((entry) => entry.name === LEGACY_DB_NAME);
    }
    return localStorage.getItem(LEGACY_KEYS.tracks) !== null;
  } catch {
    return false;
  }
}

function readAllStoreEntries(
  db: IDBDatabase,
  storeName: string
): Promise<Array<{ key: IDBValidKey; value: unknown }>> {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([]);
      return;
    }
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const entries: Array<{ key: IDBValidKey; value: unknown }> = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          entries.push({ key: cursor.key, value: cursor.value });
          cursor.continue();
        } else {
          resolve(entries);
        }
      };
      cursorReq.onerror = () => resolve(entries);
      tx.onabort = () => resolve(entries);
    } catch {
      resolve([]);
    }
  });
}

async function migrateLegacyAudioDBIfNeeded(targetDb: IDBDatabase): Promise<void> {
  if (dbMigrationPromise) return dbMigrationPromise;
  dbMigrationPromise = (async () => {
    try {
      const shouldMigrate = await hasLegacyAudioDatabase();
      if (!shouldMigrate) {
        try {
          localStorage.setItem(DB_MIGRATED_FLAG, '1');
        } catch {
          // ignore
        }
        return;
      }

      const legacyDb = await new Promise<IDBDatabase | null>((resolve) => {
        try {
          const req = indexedDB.open(LEGACY_DB_NAME);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });

      if (!legacyDb) return;

      try {
        const [audioEntries, metaEntries] = await Promise.all([
          readAllStoreEntries(legacyDb, STORE_AUDIO),
          readAllStoreEntries(legacyDb, STORE_META),
        ]);

        if (audioEntries.length > 0 || metaEntries.length > 0) {
          await new Promise<void>((resolve) => {
            const storeNames = [STORE_AUDIO, STORE_META];
            const tx = targetDb.transaction(storeNames, 'readwrite');
            const audioStore = tx.objectStore(STORE_AUDIO);
            const metaStore = tx.objectStore(STORE_META);
            for (const item of audioEntries) {
              audioStore.put(item.value, item.key);
            }
            for (const item of metaEntries) {
              metaStore.put(item.value, item.key);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          });
        }

        try {
          localStorage.setItem(DB_MIGRATED_FLAG, '1');
        } catch {
          // ignore
        }
      } finally {
        legacyDb.close();
      }
    } catch {
      // keep app responsive even if migration fails
    }
  })();
  return dbMigrationPromise;
}

function openAudioDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    req.onsuccess = async () => {
      const db = req.result;
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      await migrateLegacyAudioDBIfNeeded(db);
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB open blocked'));
    };
  });
  return dbPromise;
}

export async function saveAudioBlobToDB(trackId: string, blob: Blob): Promise<void> {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readwrite');
    tx.objectStore(STORE_AUDIO).put(blob, trackId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB write error'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

export async function saveAudioBlobsBatchToDB(
  entries: Array<{ id: string; blob: Blob }>
): Promise<void> {
  if (entries.length === 0) return;
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readwrite');
    const store = tx.objectStore(STORE_AUDIO);
    for (const item of entries) {
      store.put(item.blob, item.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB batch transaction error'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB batch transaction aborted'));
  });
}

export async function loadAudioBlobFromDB(trackId: string): Promise<Blob | null> {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readonly');
    const req = tx.objectStore(STORE_AUDIO).get(trackId);
    req.onsuccess = () => resolve((req.result as Blob) || null);
    req.onerror = () => reject(req.error || new Error('IndexedDB read error'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB read aborted'));
  });
}

export async function deleteAudioBlobFromDB(trackId: string): Promise<void> {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readwrite');
    tx.objectStore(STORE_AUDIO).delete(trackId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB delete error'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted'));
  });
}

export function loadSavedTracks(): PracticeTrack[] | null {
  try {
    const raw = readStorageWithLegacyMigration(KEYS.tracks, LEGACY_KEYS.tracks);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function saveTracks(tracks: PracticeTrack[]): void {
  try {
    localStorage.setItem(KEYS.tracks, JSON.stringify(tracks));
  } catch {
    // ignore storage quota errors
  }
}

export function loadSavedSetlists(): Setlist[] | null {
  try {
    const raw = readStorageWithLegacyMigration(KEYS.setlists, LEGACY_KEYS.setlists);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSetlists(setlists: Setlist[]): void {
  try {
    localStorage.setItem(KEYS.setlists, JSON.stringify(setlists));
  } catch {
    // ignore
  }
}

export function loadSettings(): StudioSettings {
  try {
    const raw = readStorageWithLegacyMigration(KEYS.settings, LEGACY_KEYS.settings);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StudioSettings>;
    const merged: StudioSettings = { ...DEFAULT_SETTINGS, ...parsed };
    if (
      !parsed.headerLogoDataUrl ||
      parsed.headerLogoDataUrl.startsWith('/assets/aistudio/') ||
      parsed.headerLogoDataUrl.startsWith('/icon-') ||
      parsed.headerLogoDataUrl.startsWith('/logo-vs-')
    ) {
      merged.headerLogoDataUrl = DEFAULT_HEADER_LOGO;
      merged.headerBrandMode = 'both';
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: StudioSettings): void {
  try {
    localStorage.setItem(KEYS.settings, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function loadActiveIds(): { trackId: string | null; setlistId: string | null } {
  try {
    return {
      trackId: readStorageWithLegacyMigration(KEYS.activeTrackId, LEGACY_KEYS.activeTrackId),
      setlistId: readStorageWithLegacyMigration(KEYS.activeSetlistId, LEGACY_KEYS.activeSetlistId),
    };
  } catch {
    return {
      trackId: null,
      setlistId: null,
    };
  }
}

export function saveActiveIds(trackId: string, setlistId: string): void {
  try {
    localStorage.setItem(KEYS.activeTrackId, trackId);
    localStorage.setItem(KEYS.activeSetlistId, setlistId);
  } catch {
    // ignore
  }
}

export function loadLastFolderName(): string {
  try {
    return readStorageWithLegacyMigration(KEYS.lastFolderName, LEGACY_KEYS.lastFolderName) || '';
  } catch {
    return '';
  }
}

export function saveLastFolderName(name: string): void {
  try {
    if (name) localStorage.setItem(KEYS.lastFolderName, name);
  } catch {
    // ignore
  }
}

export async function saveLastDirHandle(handle: unknown): Promise<void> {
  try {
    const db = await openAudioDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put(handle, 'lastMusicDir');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore if browser cannot clone FileSystemDirectoryHandle
  }
}

export async function loadLastDirHandle<T = unknown>(): Promise<T | null> {
  try {
    const db = await openAudioDB();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get('lastMusicDir');
      req.onsuccess = () => resolve((req.result as T) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
