export function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

export function isIPadOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

export function isIOSOrIPadOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || isIPadOS();
}

export interface RiveraDesktopBridge {
  isDesktop?: boolean;
  platform?: string;
}

export function isNativeDesktopShell(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const bridge = (window as unknown as { riveraDesktop?: RiveraDesktopBridge }).riveraDesktop;
  if (bridge?.isDesktop) return true;
  if (window.location?.protocol === 'app:') return true;
  return /Electron/i.test(navigator.userAgent);
}

export function isNativeMobileShell(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (
    window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }
  ).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  const plat = cap?.getPlatform?.();
  return plat === 'android' || plat === 'ios';
}

export function isRunningInsideNativeShell(): boolean {
  return isNativeDesktopShell() || isNativeMobileShell();
}

export function getRuntimePlatformLabel(): 'Windows' | 'macOS' | 'Android' | 'iOS / iPadOS' | 'Desktop' | 'Web' {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'Web';
  const desktopBridge = (window as unknown as { riveraDesktop?: RiveraDesktopBridge }).riveraDesktop;
  const plat = desktopBridge?.platform || '';
  if (plat === 'win32' || /Windows/i.test(navigator.userAgent)) return 'Windows';
  if (plat === 'darwin' || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints <= 1)) {
    return 'macOS';
  }
  if (isAndroidDevice()) return 'Android';
  if (isIOSOrIPadOS()) return 'iOS / iPadOS';
  if (isNativeDesktopShell()) return 'Desktop';
  return 'Web';
}

export function isHandheldOrTablet(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  if (isNativeDesktopShell()) return false;
  if (isAndroidDevice() || isIOSOrIPadOS()) return true;
  if (/Mobile|Tablet/i.test(navigator.userAgent)) return true;

  const minViewportEdge = Math.min(window.innerWidth, window.innerHeight);
  const minScreenEdge = Math.min(
    window.screen?.width || 9999,
    window.screen?.height || 9999
  );
  const isCoarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

  return (
    (navigator.maxTouchPoints > 1 && (minViewportEdge < 1024 || minScreenEdge < 1024)) ||
    (isCoarsePointer && minScreenEdge < 1200)
  );
}

export function createAudioContextSafe(options?: AudioContextOptions): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  if (options) {
    try {
      return new Ctor(options);
    } catch {
      // Older Safari/WebKit builds throw on unfamiliar AudioContextOptions keys
    }
  }
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

export async function resumeAudioContextSafe(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'running' || ctx.state === 'closed') return;
  try {
    await ctx.resume();
  } catch {
    // Ignore if browser awaits user gesture
  }
}

export function playSilentAudioUnlock(ctx: AudioContext): void {
  try {
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    source.onended = () => {
      try {
        source.disconnect();
      } catch {
        // ignore
      }
    };
  } catch {
    // ignore unlock failures
  }
}

export function decodeAudioDataSafe(
  ctx: AudioContext,
  arrayBuffer: ArrayBuffer
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onSuccess = (decoded: AudioBuffer) => {
      if (!settled) {
        settled = true;
        resolve(decoded);
      }
    };
    const onError = (err: unknown) => {
      if (!settled) {
        settled = true;
        reject(err instanceof Error ? err : new Error('Failed to decode audio data'));
      }
    };

    try {
      const maybePromise = ctx.decodeAudioData(arrayBuffer, onSuccess, onError);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(onSuccess, onError);
      }
    } catch (err) {
      onError(err);
    }
  });
}
