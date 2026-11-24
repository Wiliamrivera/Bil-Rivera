import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, Loader2, RefreshCw, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall, usePWAUpdate } from '../hooks/usePWAInstall';
import { TranslationDict } from '../i18n/translations';
import { isRunningInsideNativeShell } from '../utils/platform';

interface PWAInstallButtonProps {
  t: TranslationDict;
  showManualGuide?: boolean;
  compact?: boolean;
  label?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = React.memo(({
  t,
  showManualGuide = false,
  compact = false,
  label,
}) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, isAndroidWebView, chromeIntentUrl, inIframe, install } =
    usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled || inIframe || isRunningInsideNativeShell()) {
    return null;
  }

  if (!isInstallable && !isIOS && !showManualGuide) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted && showManualGuide) {
        setShowGuideModal(true);
      }
      return;
    }
    setShowGuideModal(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          compact
            ? 'w-full min-h-[42px] px-3.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors'
            : 'min-h-[44px] w-full px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition-transform'
        }
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{label || t.pwa.installButton}</span>
      </button>

      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="w-full max-w-sm bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-2xl p-5 flex flex-col gap-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-zinc-100">
                  {t.pwa.guideTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                aria-label={t.pwa.close}
                className="w-8 h-8 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="text-sm text-slate-700 dark:text-zinc-300 flex flex-col gap-2 leading-relaxed">
                <p>{t.pwa.iosStep1}</p>
                <p>{t.pwa.iosStep2}</p>
                <p>{t.pwa.iosStep3}</p>
              </div>
            ) : (
              <div className="text-sm text-slate-700 dark:text-zinc-300 flex flex-col gap-2 leading-relaxed">
                {isAndroid && isAndroidWebView && chromeIntentUrl && (
                  <a
                    href={chromeIntentUrl}
                    className="min-h-[44px] w-full mb-1 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 shrink-0" />
                    <span>{t.pwa.openInChrome}</span>
                  </a>
                )}
                <p>{t.pwa.androidStep1}</p>
                <p>{t.pwa.androidStep2}</p>
                <p>{t.pwa.androidStep3}</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="min-h-[44px] w-full rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] text-sm font-semibold text-slate-900 dark:text-zinc-100 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
            >
              {t.pwa.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
});

interface PWAUpdateButtonProps {
  t: TranslationDict;
}

export const PWAUpdateButton: React.FC<PWAUpdateButtonProps> = React.memo(({ t }) => {
  const { needRefresh, checking, checkForUpdate, applyUpdate } = usePWAUpdate();
  const [statusMsg, setStatusMsg] = useState<string>('');
  const statusTimerRef = React.useRef<number | null>(null);
  const isNativeShell = isRunningInsideNativeShell();

  React.useEffect(() => {
    return () => {
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const handleCheck = async () => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    setStatusMsg('');
    if (needRefresh) {
      await applyUpdate();
      return;
    }
    const res = await checkForUpdate();
    if (res === 'ready') {
      await applyUpdate();
    } else {
      setStatusMsg(res === 'offline' ? t.pwa.updateOffline : t.pwa.updateLatest);
      statusTimerRef.current = window.setTimeout(() => {
        setStatusMsg('');
        statusTimerRef.current = null;
      }, 3500);
    }
  };

  if (isNativeShell) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleCheck}
        disabled={checking}
        className={`min-h-[42px] w-full px-4 rounded-xl border text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors ${
          needRefresh
            ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/30'
            : 'bg-[var(--surface-control)] border-[var(--surface-border)] hover:border-slate-400 dark:hover:border-zinc-500 text-slate-800 dark:text-zinc-200'
        }`}
      >
        <RefreshCw className={`w-4 h-4 shrink-0 ${checking ? 'animate-spin' : ''}`} />
        <span>
          {checking
            ? t.pwa.updateChecking
            : needRefresh
              ? t.pwa.updateReady
              : t.pwa.updateCheck}
        </span>
      </button>
      {statusMsg && <p className="text-xs text-center text-slate-600 dark:text-zinc-400">{statusMsg}</p>}
    </div>
  );
});

interface OfflineIndicatorProps {
  t: TranslationDict;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = React.memo(({ t }) => {
  const isOnline = useOnlineStatus();
  const { needRefresh, applyUpdate } = usePWAUpdate();

  if (isRunningInsideNativeShell()) {
    return null;
  }

  return (
    <>
      {needRefresh && (
        <button
          type="button"
          onClick={applyUpdate}
          className="fixed top-[max(0.5rem,env(safe-area-inset-top))] left-[max(0.5rem,env(safe-area-inset-left))] z-50 flex items-center gap-1.5 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-bold text-[#0D0F12] shadow-lg cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          <span>{t.pwa.updateReady}</span>
        </button>
      )}
      {!isOnline && (
        <div className="fixed top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))] z-50 flex items-center gap-1.5 rounded-lg bg-amber-500/95 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-fg)] shadow-lg">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>{t.pwa.offlineBanner}</span>
        </div>
      )}
    </>
  );
});

interface AndroidDirectInstallerSheetProps {
  t: TranslationDict;
  ready: boolean;
}

export const AndroidDirectInstallerSheet: React.FC<AndroidDirectInstallerSheetProps> = React.memo(
  ({ t, ready }) => {
    const {
      isAndroid,
      isAndroidWebView,
      isInstalled,
      isInstallable,
      inIframe,
      hasInstallParam,
      chromeIntentUrl,
      install,
      dismissInstallParam,
    } = usePWAInstall();
    const [promptWaitDone, setPromptWaitDone] = useState(false);

    const shouldShow =
      ready && isAndroid && !isInstalled && !inIframe && !isRunningInsideNativeShell() && hasInstallParam;

    useEffect(() => {
      if (!shouldShow || isInstallable || isAndroidWebView) return;
      const timer = window.setTimeout(() => {
        setPromptWaitDone(true);
      }, 1700);
      return () => window.clearTimeout(timer);
    }, [shouldShow, isInstallable, isAndroidWebView]);

    if (!shouldShow) {
      return null;
    }

    const handleDirectInstall = async () => {
      const accepted = await install();
      if (accepted) {
        dismissInstallParam();
      } else {
        setPromptWaitDone(true);
      }
    };

    return (
      <div
        className="fixed inset-0 z-[75] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        role="dialog"
        aria-modal="true"
        aria-label={t.pwa.guideTitle}
      >
        <div className="w-full max-w-sm bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-2xl p-5 flex flex-col gap-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src="/icon-192-v12.png"
                alt={t.pwa.shareAppTitle}
                width={48}
                height={48}
                className="w-12 h-12 rounded-xl border border-black/15 dark:border-white/15 shrink-0"
              />
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-zinc-100 truncate">
                  {t.pwa.shareAppTitle}
                </h3>
                <p className="text-xs text-slate-600 dark:text-zinc-400 leading-snug mt-0.5">
                  {t.pwa.directSheetSubtitle}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissInstallParam}
              aria-label={t.pwa.close}
              className="w-8 h-8 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {isAndroidWebView && chromeIntentUrl ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">
                {t.pwa.openInChromeHint}
              </p>
              <a
                href={chromeIntentUrl}
                className="min-h-[48px] w-full px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <ExternalLink className="w-4 h-4 shrink-0" />
                <span>{t.pwa.openInChrome}</span>
              </a>
            </div>
          ) : isInstallable ? (
            <button
              type="button"
              onClick={handleDirectInstall}
              className="min-h-[48px] w-full px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition-transform shadow-md"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>{t.pwa.installNowOneTap}</span>
            </button>
          ) : !promptWaitDone ? (
            <div className="min-h-[48px] w-full px-4 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] text-slate-700 dark:text-zinc-200 text-xs font-semibold flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 shrink-0 animate-spin text-amber-500" />
              <span>{t.pwa.preparingInstaller}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {chromeIntentUrl && (
                <a
                  href={chromeIntentUrl}
                  className="min-h-[46px] w-full px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <span>{t.pwa.openInChrome}</span>
                </a>
              )}
              <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">
                {t.pwa.androidFallbackNote}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={dismissInstallParam}
            className="min-h-[42px] w-full rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
          >
            {t.pwa.continueInBrowser}
          </button>
        </div>
      </div>
    );
  }
);
