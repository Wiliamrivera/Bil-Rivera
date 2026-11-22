import { PracticeTrack, Setlist, StudioSettings } from '../types/studio';

const DB_NAME = 'riffForgeAudioDB';
const DB_VERSION = 2;
const STORE_AUDIO = 'audioFiles';
const STORE_META = 'meta';

const KEYS = {
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

let dbPromise: Promise<IDBDatabase> | null = null;

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
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
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
    tx.onerror = () => reject(tx.error);
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
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB batch transaction aborted'));
  });
}

export async function loadAudioBlobFromDB(trackId: string): Promise<Blob | null> {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readonly');
    const req = tx.objectStore(STORE_AUDIO).get(trackId);
    req.onsuccess = () => resolve((req.result as Blob) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAudioBlobFromDB(trackId: string): Promise<void> {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readwrite');
    tx.objectStore(STORE_AUDIO).delete(trackId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function loadSavedTracks(): PracticeTrack[] | null {
  try {
    const raw = localStorage.getItem(KEYS.tracks);
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
    const raw = localStorage.getItem(KEYS.setlists);
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
    const raw = localStorage.getItem(KEYS.settings);
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
      trackId: localStorage.getItem(KEYS.activeTrackId),
      setlistId: localStorage.getItem(KEYS.activeSetlistId),
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
    return localStorage.getItem(KEYS.lastFolderName) || '';
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
