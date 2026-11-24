import { useCallback, useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { resolveAppDistributionLinks } from '../utils/appDistribution';
import { isAndroidDevice, isIOSOrIPadOS, isRunningInsideNativeShell } from '../utils/platform';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Shared Service Worker update state across the app
let swInitialized = false;
let swRegistration: ServiceWorkerRegistration | null = null;
let triggerSWUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
let swPollIntervalId: number | null = null;
let swNeedRefresh = false;
let controllerChanged = false;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

export function initAppServiceWorker() {
  if (typeof window === 'undefined' || swInitialized || isRunningInsideNativeShell()) return;
  swInitialized = true;
  try {
    const hadController = Boolean(navigator.serviceWorker?.controller);
    let sawInitialClaim = false;
    let lastUpdateCheckAt = 0;

    const triggerCheck = () => {
      if (!swRegistration || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
      const now = Date.now();
      if (now - lastUpdateCheckAt < 15000) return;
      lastUpdateCheckAt = now;
      swRegistration.update().catch(() => {});
    };

    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController && !sawInitialClaim) {
          sawInitialClaim = true;
          return;
        }
        controllerChanged = true;
        swNeedRefresh = true;
        notifyListeners();
        try {
          const reloadKey = 'rivera_sw_reloaded_v1';
          const lastReload = Number(window.sessionStorage.getItem(reloadKey) || '0');
          if (Date.now() - lastReload > 10000) {
            window.sessionStorage.setItem(reloadKey, String(Date.now()));
            window.location.reload();
          }
        } catch {
          window.location.reload();
        }
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        triggerCheck();
      }
    });
    window.addEventListener('online', triggerCheck);

    triggerSWUpdate = registerSW({
      immediate: true,
      onNeedRefresh() {
        swNeedRefresh = true;
        notifyListeners();
      },
      onRegisteredSW(_swUrl, reg) {
        if (!reg) return;
        swRegistration = reg;
        lastUpdateCheckAt = Date.now();
        window.setTimeout(() => {
          if (typeof navigator !== 'undefined' && navigator.onLine) {
            reg.update().catch(() => {});
          }
        }, 1800);
        if (swPollIntervalId !== null) {
          window.clearInterval(swPollIntervalId);
        }
        swPollIntervalId = window.setInterval(() => {
          if (typeof navigator !== 'undefined' && navigator.onLine) {
            reg.update().catch(() => {});
          }
        }, 5 * 60 * 1000);
      },
    });
  } catch {
    // ignore in environments without SW support
  }
}

async function hasLiveBundleChanged(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof fetch !== 'function') {
    return false;
  }
  try {
    const activeScripts = Array.from(document.querySelectorAll('script[src]'))
      .map((s) => s.getAttribute('src') || '')
      .filter((src) => /\/assets\/main-[^"'\s]+\.js/i.test(src));
    if (activeScripts.length === 0) {
      return false;
    }
    const resp = await fetch(`/?_v=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!resp.ok) return false;
    const html = await resp.text();
    const matches = html.match(/\/assets\/main-[^"'\s]+\.js/gi);
    if (!matches || matches.length === 0) return false;
    return matches.some((m) => !activeScripts.some((curr) => curr.endsWith(m) || curr.includes(m)));
  } catch {
    return false;
  }
}

export function usePWAUpdate() {
  const [needRefresh, setNeedRefresh] = useState(swNeedRefresh);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const sync = () => setNeedRefresh(swNeedRefresh);
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    try {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith('rivera-app-runtime') || k.startsWith('workbox-precache'))
            .map((k) => caches.delete(k))
        );
      }
    } catch {
      // ignore cache cleanup failures
    }
    if (swRegistration?.waiting) {
      try {
        swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      } catch {
        // ignore
      }
    }
    if (triggerSWUpdate) {
      try {
        await triggerSWUpdate(true);
      } catch {
        // proceed with reload even if SW skipWaiting fails
      }
    }
    window.location.reload();
  }, []);

  const checkForUpdate = useCallback(async (): Promise<'ready' | 'latest' | 'offline'> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 'offline';
    }
    setChecking(true);
    try {
      const reg =
        swRegistration ||
        (typeof navigator !== 'undefined' && navigator.serviceWorker
          ? (await navigator.serviceWorker.getRegistration()) || null
          : null);
      if (reg) {
        swRegistration = reg;
        const prevScriptUrl = reg.active?.scriptURL || null;
        await reg.update();

        const installing = reg.installing;
        if (installing) {
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            const timer = window.setTimeout(done, 4000);
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' || installing.state === 'activated' || installing.state === 'redundant') {
                window.clearTimeout(timer);
                resolve();
              }
            });
          });
        }

        const nextScriptUrl = reg.active?.scriptURL || null;
        if (
          controllerChanged ||
          reg.waiting ||
          swNeedRefresh ||
          (prevScriptUrl && nextScriptUrl && prevScriptUrl !== nextScriptUrl)
        ) {
          swNeedRefresh = true;
          notifyListeners();
          return 'ready';
        }
      }

      const bundleChanged = await hasLiveBundleChanged();
      if (bundleChanged) {
        swNeedRefresh = true;
        notifyListeners();
        return 'ready';
      }

      return swNeedRefresh || controllerChanged ? 'ready' : 'latest';
    } catch {
      return 'latest';
    } finally {
      setChecking(false);
    }
  }, []);

  return {
    needRefresh,
    checking,
    checkForUpdate,
    applyUpdate,
  };
}

export function isAndroidUserAgent(): boolean {
  return isAndroidDevice();
}

export function isAndroidInAppBrowserUA(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Android/i.test(ua) && /wv\)|FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger|Telegram/i.test(ua);
}

export function getDirectAppInstallerUrl(): string {
  if (typeof window === 'undefined') return '';
  return resolveAppDistributionLinks().androidInstallUrl;
}

export function getAndroidChromeIntentUrl(targetUrl: string): string {
  if (!targetUrl) return '';
  const cleanUrl = targetUrl.replace(/^https?:\/\//i, '');
  return `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(targetUrl)};end`;
}

export function hasInstallQueryFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('install') === '1';
  } catch {
    return false;
  }
}

export function clearInstallQueryFlag(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('install')) {
      url.searchParams.delete('install');
      const next = `${url.pathname}${url.search}${url.hash}` || '/';
      window.history.replaceState(window.history.state, '', next);
    }
  } catch {
    // ignore history errors
  }
}

// Capture beforeinstallprompt early at module evaluation so late React mount never misses it
let earlyDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

function isRunningInsideIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

if (typeof window !== 'undefined' && !isRunningInsideIframe()) {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    earlyDeferredPrompt = e as BeforeInstallPromptEvent;
    promptListeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    earlyDeferredPrompt = null;
    promptListeners.forEach((fn) => fn());
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => earlyDeferredPrompt
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isAndroidWebView, setIsAndroidWebView] = useState(false);
  const [inIframe, setInIframe] = useState(false);
  const [hasInstallParam, setHasInstallParam] = useState(() => hasInstallQueryFlag());

  useEffect(() => {
    const insideFrame = isRunningInsideIframe();
    const insideNativeShell = isRunningInsideNativeShell();
    setInIframe(insideFrame);

    const isStandalone =
      insideNativeShell ||
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    setIsIOS(isIOSOrIPadOS());
    setIsAndroid(isAndroidUserAgent());
    setIsAndroidWebView(isAndroidInAppBrowserUA());

    if (earlyDeferredPrompt && !insideFrame) {
      setDeferredPrompt(earlyDeferredPrompt);
    }

    const syncPrompt = () => {
      if (!insideFrame) {
        setDeferredPrompt(earlyDeferredPrompt);
      }
    };
    promptListeners.add(syncPrompt);

    const handleAppInstalled = () => {
      earlyDeferredPrompt = null;
      setIsInstalled(true);
      setDeferredPrompt(null);
      setHasInstallParam(false);
      clearInstallQueryFlag();
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      promptListeners.delete(syncPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    const targetPrompt = deferredPrompt || earlyDeferredPrompt;
    if (!targetPrompt || inIframe) return false;
    try {
      await targetPrompt.prompt();
      const { outcome } = await targetPrompt.userChoice;
      if (outcome === 'accepted') {
        earlyDeferredPrompt = null;
        setIsInstalled(true);
        setDeferredPrompt(null);
        setHasInstallParam(false);
        clearInstallQueryFlag();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const dismissInstallParam = useCallback(() => {
    setHasInstallParam(false);
    clearInstallQueryFlag();
  }, []);

  const directUrl = getDirectAppInstallerUrl();
  const chromeIntentUrl = isAndroid ? getAndroidChromeIntentUrl(directUrl) : '';

  return {
    isInstallable: !isRunningInsideNativeShell() && !inIframe && !!deferredPrompt,
    isInstalled,
    isIOS,
    isAndroid,
    isAndroidWebView,
    inIframe,
    hasInstallParam,
    chromeIntentUrl,
    install,
    dismissInstallParam,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
