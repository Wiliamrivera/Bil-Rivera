interface RiveraAndroidNativeBridge {
  setKeepScreenOn?: (enabled: boolean) => void;
  saveWavFile?: (base64Data: string, fileName: string) => boolean;
  shareWavFile?: (base64Data: string, fileName: string) => boolean;
}

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

let activeWakeLockSentinel: WakeLockSentinelLike | null = null;
let wakeLockDesired = false;
let visibilityBound = false;

function getAndroidBridge(): RiveraAndroidNativeBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { RiveraAndroidBridge?: RiveraAndroidNativeBridge })
    .RiveraAndroidBridge;
  return bridge || null;
}

async function acquireWebWakeLock(): Promise<void> {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as unknown as NavigatorWithWakeLock;
  if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  if (activeWakeLockSentinel && !activeWakeLockSentinel.released) return;

  try {
    activeWakeLockSentinel = await nav.wakeLock.request('screen');
  } catch {
    activeWakeLockSentinel = null;
  }
}

async function releaseWebWakeLock(): Promise<void> {
  const sentinel = activeWakeLockSentinel;
  activeWakeLockSentinel = null;
  if (sentinel && !sentinel.released) {
    try {
      await sentinel.release();
    } catch {
      // ignore release failures on backgrounded tabs
    }
  }
}

function ensureVisibilityReacquireListener(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeLockDesired) {
      void acquireWebWakeLock();
    }
  });
}

export function setPlaybackKeepScreenOn(enabled: boolean): void {
  wakeLockDesired = enabled;
  ensureVisibilityReacquireListener();

  const bridge = getAndroidBridge();
  if (bridge?.setKeepScreenOn) {
    try {
      bridge.setKeepScreenOn(enabled);
    } catch {
      // ignore native bridge failures
    }
  }

  if (enabled) {
    void acquireWebWakeLock();
  } else {
    void releaseWebWakeLock();
  }
}

export function hasNativeAndroidSaveBridge(): boolean {
  const bridge = getAndroidBridge();
  return typeof bridge?.saveWavFile === 'function';
}

export function hasNativeAndroidShareBridge(): boolean {
  const bridge = getAndroidBridge();
  return typeof bridge?.shareWavFile === 'function';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      if (commaIdx >= 0) {
        resolve(result.slice(commaIdx + 1));
      } else {
        reject(new Error('Invalid data URL while encoding audio export'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

export async function saveAudioFileNative(blob: Blob, fileName: string): Promise<boolean> {
  const bridge = getAndroidBridge();
  if (typeof bridge?.saveWavFile !== 'function') return false;
  try {
    const base64 = await blobToBase64(blob);
    return bridge.saveWavFile(base64, fileName) === true;
  } catch {
    return false;
  }
}

export async function shareAudioFileNative(blob: Blob, fileName: string): Promise<boolean> {
  const bridge = getAndroidBridge();
  if (typeof bridge?.shareWavFile !== 'function') return false;
  try {
    const base64 = await blobToBase64(blob);
    return bridge.shareWavFile(base64, fileName) === true;
  } catch {
    return false;
  }
}
