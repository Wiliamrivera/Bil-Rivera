import { useEffect, useState } from 'react';

interface BootVideoState {
  ended?: boolean;
  error?: boolean;
  blocked?: boolean;
  started?: boolean;
}

export function useBootSplash(): boolean {
  const [bootSplashDone, setBootSplashDone] = useState<boolean>(
    () => typeof document !== 'undefined' && !document.getElementById('rivera-boot-splash')
  );

  useEffect(() => {
    const splash = document.getElementById('rivera-boot-splash');
    if (!splash) {
      setBootSplashDone(true);
      return;
    }

    const splashVideo = document.getElementById('rivera-boot-splash-video') as HTMLVideoElement | null;
    const splashFallback = document.getElementById('rivera-boot-splash-fallback') as HTMLImageElement | null;
    const bootState = (window as unknown as { __riveraBootVideoState?: BootVideoState })
      .__riveraBootVideoState;

    let cancelled = false;
    let holdTimer = 0;
    let removeTimer = 0;
    let safetyTimer = 0;
    let stallTimer = 0;
    let dismissed = false;
    const mountedAt = Date.now();

    const finalizeDismiss = () => {
      if (dismissed || cancelled) return;
      dismissed = true;
      splash.removeEventListener('transitionend', onTransitionEnd);
      window.clearTimeout(holdTimer);
      window.clearTimeout(removeTimer);
      window.clearTimeout(safetyTimer);
      window.clearTimeout(stallTimer);
      if (splashVideo) {
        try {
          splashVideo.pause();
        } catch {
          // ignore media pause errors during cleanup
        }
      }
      splash.remove();
      setBootSplashDone(true);
    };

    const onTransitionEnd = (ev: TransitionEvent) => {
      if (ev.target === splash && ev.propertyName === 'opacity') {
        finalizeDismiss();
      }
    };

    const startFadeOut = () => {
      if (cancelled || dismissed) return;
      window.clearTimeout(holdTimer);
      window.clearTimeout(safetyTimer);
      window.clearTimeout(stallTimer);
      splash.addEventListener('transitionend', onTransitionEnd);
      splash.style.pointerEvents = 'none';
      splash.style.opacity = '0';
      splash.style.transform = 'scale(1.02) translateZ(0)';
      removeTimer = window.setTimeout(finalizeDismiss, 320);
    };

    const showFallbackAndExit = (delayMs = 240) => {
      if (cancelled || dismissed) return;
      if (splashVideo) splashVideo.style.display = 'none';
      if (splashFallback) {
        splashFallback.style.display = 'block';
        splashFallback.style.opacity = '1';
      }
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(startFadeOut, delayMs);
    };

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!splashVideo || prefersReducedMotion) {
      showFallbackAndExit(prefersReducedMotion ? 120 : 80);
      return () => {
        cancelled = true;
        splash.removeEventListener('transitionend', onTransitionEnd);
        window.clearTimeout(holdTimer);
        window.clearTimeout(removeTimer);
      };
    }

    if (splashVideo.ended || bootState?.ended) {
      startFadeOut();
      return () => {
        cancelled = true;
        splash.removeEventListener('transitionend', onTransitionEnd);
        window.clearTimeout(removeTimer);
      };
    }

    if (bootState?.error || bootState?.blocked) {
      showFallbackAndExit(280);
      return () => {
        cancelled = true;
        splash.removeEventListener('transitionend', onTransitionEnd);
        window.clearTimeout(holdTimer);
        window.clearTimeout(removeTimer);
      };
    }

    const onVideoReady = () => {
      if (cancelled) return;
      splashVideo.style.opacity = '1';
      window.clearTimeout(stallTimer);
    };

    const onVideoEnded = () => startFadeOut();
    const onVideoError = () => showFallbackAndExit(260);

    const onLoadedMetadata = () => {
      if (cancelled || dismissed) return;
      if (Number.isFinite(splashVideo.duration) && splashVideo.duration > 0) {
        window.clearTimeout(safetyTimer);
        const capMs = Math.min(11500, Math.ceil(splashVideo.duration * 1000) + 1200);
        safetyTimer = window.setTimeout(startFadeOut, capMs);
      }
    };

    const onSplashTap = () => {
      if (Date.now() - mountedAt >= 400) {
        startFadeOut();
      }
    };

    splashVideo.addEventListener('playing', onVideoReady);
    splashVideo.addEventListener('loadeddata', onVideoReady);
    splashVideo.addEventListener('loadedmetadata', onLoadedMetadata);
    splashVideo.addEventListener('ended', onVideoEnded);
    splashVideo.addEventListener('error', onVideoError);
    splash.addEventListener('click', onSplashTap);
    splash.addEventListener('touchend', onSplashTap, { passive: true });

    if (splashVideo.readyState >= 2) {
      onVideoReady();
    }
    if (Number.isFinite(splashVideo.duration) && splashVideo.duration > 0) {
      onLoadedMetadata();
    } else {
      safetyTimer = window.setTimeout(startFadeOut, 10000);
    }

    stallTimer = window.setTimeout(() => {
      if (cancelled || dismissed) return;
      if (splashVideo.readyState < 2 || (splashVideo.paused && splashVideo.currentTime === 0)) {
        showFallbackAndExit(200);
      }
    }, 1400);

    if (splashVideo.paused && !splashVideo.ended) {
      splashVideo.muted = true;
      splashVideo.defaultMuted = true;
      splashVideo.playsInline = true;
      splashVideo.play().catch(() => {
        showFallbackAndExit(220);
      });
    }

    return () => {
      cancelled = true;
      splash.removeEventListener('transitionend', onTransitionEnd);
      splash.removeEventListener('click', onSplashTap);
      splash.removeEventListener('touchend', onSplashTap);
      splashVideo.removeEventListener('playing', onVideoReady);
      splashVideo.removeEventListener('loadeddata', onVideoReady);
      splashVideo.removeEventListener('loadedmetadata', onLoadedMetadata);
      splashVideo.removeEventListener('ended', onVideoEnded);
      splashVideo.removeEventListener('error', onVideoError);
      window.clearTimeout(holdTimer);
      window.clearTimeout(removeTimer);
      window.clearTimeout(safetyTimer);
      window.clearTimeout(stallTimer);
    };
  }, []);

  return bootSplashDone;
}
