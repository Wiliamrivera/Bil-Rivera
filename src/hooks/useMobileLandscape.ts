import { useEffect, useState } from 'react';
import { isHandheldOrTablet } from '../utils/platform';

interface ScreenOrientationCompat {
  type?: string;
  unlock?: () => void;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

export function useMobileLandscape(isMobileClient: boolean): boolean {
  const [isMobileLandscape, setIsMobileLandscape] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (!isHandheldOrTablet()) return false;
    const screenType = window.screen?.orientation?.type;
    if (typeof screenType === 'string' && screenType.length > 0) {
      return screenType.startsWith('landscape') || window.innerWidth > window.innerHeight;
    }
    return window.innerWidth > window.innerHeight;
  });

  useEffect(() => {
    if (!isMobileClient || typeof window === 'undefined') {
      setIsMobileLandscape(false);
      return;
    }

    const screenOrientation = (
      window.screen as unknown as { orientation?: ScreenOrientationCompat }
    )?.orientation;

    try {
      screenOrientation?.unlock?.();
    } catch {
      // Ignore on browsers that restrict orientation.unlock outside fullscreen
    }

    const mq = window.matchMedia('(orientation: landscape)');
    let settleTimer: number | null = null;
    let rafId: number | null = null;

    const readIsLandscape = (): boolean => {
      const activeTag = document.activeElement?.tagName;
      const isEditingText = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
      const screenType = screenOrientation?.type;

      if (typeof screenType === 'string' && screenType.length > 0) {
        if (isEditingText) return screenType.startsWith('landscape');
        return screenType.startsWith('landscape') || window.innerWidth > window.innerHeight;
      }

      const legacyAngle = (window as unknown as { orientation?: number }).orientation;
      if (typeof legacyAngle === 'number') {
        if (isEditingText) return Math.abs(legacyAngle) === 90;
        return Math.abs(legacyAngle) === 90 || mq.matches || window.innerWidth > window.innerHeight;
      }

      return mq.matches || window.innerWidth > window.innerHeight;
    };

    const syncOrientation = () => {
      setIsMobileLandscape(readIsLandscape());
    };

    const handleOrientationChange = () => {
      syncOrientation();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        syncOrientation();
      });
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        syncOrientation();
      }, 150);
    };

    syncOrientation();
    window.addEventListener('resize', syncOrientation);
    window.addEventListener('orientationchange', handleOrientationChange);
    mq.addEventListener?.('change', syncOrientation);
    screenOrientation?.addEventListener?.('change', handleOrientationChange);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      window.removeEventListener('resize', syncOrientation);
      window.removeEventListener('orientationchange', handleOrientationChange);
      mq.removeEventListener?.('change', syncOrientation);
      screenOrientation?.removeEventListener?.('change', handleOrientationChange);
    };
  }, [isMobileClient]);

  return isMobileLandscape;
}
