import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Globe, Link2, Moon, RotateCcw, Send, ShieldCheck, Sun } from 'lucide-react';
import { usePWAUpdate } from '../hooks/usePWAInstall';
import { TranslationDict } from '../i18n/translations';
import { APP_VERSION } from '../storage/studioStorage';
import { AppColorPalette, StudioSettings } from '../types/studio';
import {
  isAiStudioUrl,
  loadSavedDistributionUrl,
  normalizeExternalUrl,
  resolveAppDistributionLinks,
  saveDistributionUrl,
} from '../utils/appDistribution';
import { copyTextReliable } from '../utils/clipboard';
import { getRuntimePlatformLabel, isRunningInsideNativeShell } from '../utils/platform';
import { resolveThemeAndPalette } from '../utils/trackUtils';
import { PWAInstallButton, PWAUpdateButton } from './PWAInstallButton';

interface SettingsViewProps {
  t: TranslationDict;
  settings: StudioSettings;
  onUpdate: (patch: Partial<StudioSettings>) => void;
  onResetDefaults: () => void;
  onOpenPromoSite?: () => void;
}

const PALETTE_SWATCHES: {
  id: AppColorPalette;
  darkBg: string;
  darkCard: string;
  lightBg: string;
  accentDark: string;
  accentLight: string;
}[] = [
  {
    id: 'amber',
    darkBg: '#0D0F12',
    darkCard: '#15181E',
    lightBg: '#F4F5F7',
    accentDark: '#F59E0B',
    accentLight: '#D97706',
  },
  {
    id: 'crimson',
    darkBg: '#161822',
    darkCard: '#1E212E',
    lightBg: '#F6F4F6',
    accentDark: '#E11D48',
    accentLight: '#E11D48',
  },
  {
    id: 'mint',
    darkBg: '#242930',
    darkCard: '#2D333C',
    lightBg: '#F2F6F4',
    accentDark: '#3DD697',
    accentLight: '#059669',
  },
  {
    id: 'cobalt',
    darkBg: '#101622',
    darkCard: '#172030',
    lightBg: '#F2F5FA',
    accentDark: '#3B82F6',
    accentLight: '#2563EB',
  },
];

export const SettingsView: React.FC<SettingsViewProps> = React.memo(
  ({ t, settings, onUpdate, onResetDefaults, onOpenPromoSite }) => {
    const { needRefresh } = usePWAUpdate();
    const [copiedLink, setCopiedLink] = useState(false);
    const [copiedPromoLink, setCopiedPromoLink] = useState(false);
    const [savedDistUrl, setSavedDistUrl] = useState<string>(() => loadSavedDistributionUrl());
    const [distInput, setDistInput] = useState<string>(() => loadSavedDistributionUrl());
    const [editingLink, setEditingLink] = useState(false);
    const [linkError, setLinkError] = useState<string | null>(null);
    const copiedTimerRef = useRef<number | null>(null);
    const copiedPromoTimerRef = useRef<number | null>(null);

    const distributionLinks = useMemo(
      () => resolveAppDistributionLinks(savedDistUrl),
      [savedDistUrl]
    );
    const directInstallerUrl = distributionLinks.androidInstallUrl;
    const promoSiteUrl = distributionLinks.promoSiteUrl;
    const isNativeShell = isRunningInsideNativeShell();
    const runtimePlatform = getRuntimePlatformLabel();
    const { activeTheme, activePalette } = resolveThemeAndPalette(settings);

    const paletteLabels: Record<AppColorPalette, string> = {
      amber: t.settings.paletteAmber,
      crimson: t.settings.paletteCrimson,
      mint: t.settings.paletteMint,
      cobalt: t.settings.paletteCobalt,
    };

    useEffect(() => {
      return () => {
        if (copiedTimerRef.current !== null) {
          window.clearTimeout(copiedTimerRef.current);
        }
        if (copiedPromoTimerRef.current !== null) {
          window.clearTimeout(copiedPromoTimerRef.current);
        }
      };
    }, []);

    const showCopiedState = () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      setCopiedLink(true);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopiedLink(false);
        copiedTimerRef.current = null;
      }, 5000);
    };

    const handleCopyOnly = async () => {
      if (!directInstallerUrl) return;
      await copyTextReliable(directInstallerUrl);
      showCopiedState();
    };

    const handleCopyPromoSiteUrl = async () => {
      if (!promoSiteUrl) return;
      await copyTextReliable(promoSiteUrl);
      if (copiedPromoTimerRef.current !== null) {
        window.clearTimeout(copiedPromoTimerRef.current);
      }
      setCopiedPromoLink(true);
      copiedPromoTimerRef.current = window.setTimeout(() => {
        setCopiedPromoLink(false);
        copiedPromoTimerRef.current = null;
      }, 4000);
    };

    const handleSendDirectInstallerLink = async () => {
      if (!directInstallerUrl) return;

      const didCopy = await copyTextReliable(directInstallerUrl);
      if (didCopy) {
        showCopiedState();
      }

      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: t.pwa.shareAppTitle,
            url: directInstallerUrl,
          });
          return;
        } catch (err) {
          if ((err as { name?: string })?.name === 'AbortError') return;
        }
      }

      showCopiedState();
    };

    const handleSaveDirectLink = (e: React.FormEvent) => {
      e.preventDefault();
      setLinkError(null);
      const trimmed = distInput.trim();
      if (!trimmed) {
        saveDistributionUrl('');
        setSavedDistUrl('');
        setDistInput('');
        setEditingLink(false);
        return;
      }

      if (isAiStudioUrl(trimmed)) {
        setLinkError(t.pwa.directLinkAiStudioError);
        return;
      }

      const normalized = normalizeExternalUrl(trimmed);
      if (!normalized) {
        setLinkError(t.pwa.directLinkInvalidError);
        return;
      }

      const result = saveDistributionUrl(normalized);
      setSavedDistUrl(result.savedUrl);
      setDistInput(result.savedUrl);
      setEditingLink(false);
    };

    const showLinkForm = editingLink || !directInstallerUrl;

    const directShareBlock = (
      <div className="flex flex-col gap-2.5">
        {directInstallerUrl && !editingLink && (
          <>
            <button
              type="button"
              onClick={handleSendDirectInstallerLink}
              className="min-h-[44px] w-full px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition-transform"
            >
              {copiedLink ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <Send className="w-4 h-4 shrink-0" />
              )}
              <span>{copiedLink ? t.pwa.shareAppCopied : t.pwa.shareButton}</span>
            </button>

            <div className="rounded-lg bg-[var(--surface-base)] border border-[var(--surface-border-subtle)] px-3 py-2 flex items-center justify-between gap-2">
              <input
                type="text"
                readOnly
                value={directInstallerUrl}
                onClick={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 bg-transparent text-[11px] font-mono text-amber-700 dark:text-amber-300 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyOnly}
                aria-label={t.pwa.copyLinkLabel}
                className="p-1.5 rounded-md bg-white dark:bg-[var(--surface-control)] border border-[var(--surface-border)] text-slate-600 dark:text-zinc-300 hover:text-amber-700 dark:hover:text-amber-300 cursor-pointer shrink-0"
              >
                {copiedLink ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-zinc-400">
              <span>{distributionLinks.isDirectApkLink ? t.pwa.directApkBadge : t.pwa.shareAppTitle}</span>
              <button
                type="button"
                onClick={() => {
                  setDistInput(savedDistUrl || distributionLinks.configuredSourceUrl);
                  setLinkError(null);
                  setEditingLink(true);
                }}
                className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
              >
                <Link2 className="w-3 h-3" />
                <span>{t.pwa.directLinkEdit}</span>
              </button>
            </div>
          </>
        )}

        {showLinkForm && (
          <form
            onSubmit={handleSaveDirectLink}
            className="rounded-xl bg-[var(--surface-base)] border border-[var(--surface-border-subtle)] p-3.5 flex flex-col gap-2.5"
          >
            <p className="text-xs text-slate-700 dark:text-zinc-300 leading-relaxed">
              {t.pwa.directLinkSetupHint}
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                inputMode="url"
                value={distInput}
                onChange={(e) => {
                  setDistInput(e.target.value);
                  if (linkError) setLinkError(null);
                }}
                placeholder={t.pwa.directLinkPlaceholder}
                className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-[var(--surface-card)] border border-[var(--surface-border)] focus:border-amber-500 focus:outline-none text-xs font-mono text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500"
              />
              <div className="flex gap-2 shrink-0">
                <button
                  type="submit"
                  className="h-10 px-3.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  {t.pwa.directLinkSave}
                </button>
                {editingLink && directInstallerUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingLink(false);
                      setLinkError(null);
                    }}
                    className="h-10 px-3 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] text-xs font-semibold text-slate-700 dark:text-zinc-300 cursor-pointer"
                  >
                    {t.pwa.directLinkCancel}
                  </button>
                )}
              </div>
            </div>
            {linkError && <p className="text-xs text-rose-600 dark:text-rose-400">{linkError}</p>}
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">
              {t.pwa.directLinkGithubHint}
            </p>
          </form>
        )}
      </div>
    );

    return (
      <div className="flex flex-col gap-5 max-w-2xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-zinc-100">
              {t.settings.title}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-zinc-400 mt-0.5">
              {t.settings.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onResetDefaults}
            className="h-10 px-3.5 rounded-lg bg-[var(--surface-card)] border border-[var(--surface-border)] text-xs font-medium text-slate-700 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-zinc-100 flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs dark:shadow-none"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t.settings.resetAll}</span>
          </button>
        </div>

        {/* General Preferences Card: Language + Day/Night + Color Palette */}
        <div className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-5 flex flex-col gap-5 shadow-xs dark:shadow-none">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-2">
              {t.settings.language}
            </label>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-[var(--surface-base)] rounded-lg border border-[var(--surface-border-subtle)]">
              {(['pt', 'en'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => onUpdate({ language: lang })}
                  className={`min-h-[42px] px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    settings.language === lang
                      ? 'bg-white dark:bg-[var(--surface-control)] text-amber-700 dark:text-amber-400 shadow-xs dark:shadow-none'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {lang === 'pt' ? 'Português (BR)' : 'English'}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-[var(--surface-border-subtle)]">
            <label className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-2">
              {t.settings.theme}
            </label>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-[var(--surface-base)] rounded-lg border border-[var(--surface-border-subtle)]">
              <button
                type="button"
                onClick={() => onUpdate({ theme: 'dark' })}
                aria-label={t.settings.themeDark}
                title={t.settings.themeDark}
                className={`min-h-[46px] px-3 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                  activeTheme === 'dark'
                    ? 'bg-white dark:bg-[var(--surface-control)] text-amber-700 dark:text-amber-400 shadow-xs dark:shadow-none'
                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                }`}
              >
                <Moon className="w-5 h-5 shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => onUpdate({ theme: 'light' })}
                aria-label={t.settings.themeLight}
                title={t.settings.themeLight}
                className={`min-h-[46px] px-3 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                  activeTheme === 'light'
                    ? 'bg-white dark:bg-[var(--surface-control)] text-amber-700 dark:text-amber-400 shadow-xs dark:shadow-none'
                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                }`}
              >
                <Sun className="w-5 h-5 shrink-0" />
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-[var(--surface-border-subtle)]">
            <label className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-2.5">
              {t.settings.colorPalette}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PALETTE_SWATCHES.map((swatch) => {
                const isSelected = activePalette === swatch.id;
                const previewBg = activeTheme === 'dark' ? swatch.darkCard : swatch.lightBg;
                const previewAccent = activeTheme === 'dark' ? swatch.accentDark : swatch.accentLight;
                const previewSurface = activeTheme === 'dark' ? swatch.darkBg : '#FFFFFF';
                return (
                  <button
                    key={swatch.id}
                    type="button"
                    onClick={() => onUpdate({ colorPalette: swatch.id })}
                    aria-pressed={isSelected}
                    className={`min-h-[52px] px-3 py-2.5 rounded-xl border flex items-center justify-between gap-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--surface-control)] border-amber-500 ring-1 ring-amber-500/40 text-slate-900 dark:text-zinc-100'
                        : 'bg-[var(--surface-base)] border-[var(--surface-border)] text-slate-700 dark:text-zinc-300 hover:border-amber-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-6 h-6 rounded-lg border border-black/15 dark:border-white/15 flex items-center justify-center shrink-0 shadow-xs"
                        style={{ backgroundColor: previewBg }}
                        aria-hidden="true"
                      >
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor: previewAccent,
                            boxShadow: `0 0 0 2px ${previewSurface}`,
                          }}
                        />
                      </span>
                      <span className="text-xs font-semibold truncate">{paletteLabels[swatch.id]}</span>
                    </div>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Direct App Installer Link + Update + Version (Web) OR Native Offline + Share Card */}
        {isNativeShell ? (
          <div className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-5 flex flex-col gap-3 shadow-xs dark:shadow-none">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                {t.pwa.nativeOfflineTitle}
              </h3>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/35 text-[11px] font-mono font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
                {runtimePlatform} · 100% Offline
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
              {t.pwa.nativeOfflineDesc}
            </p>
            <div className="pt-3 border-t border-[var(--surface-border-subtle)] flex flex-col gap-2">
              <h4 className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                {t.pwa.shareNativeTitle}
              </h4>
              <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
                {t.pwa.shareNativeDesc}
              </p>
              {directShareBlock}
            </div>
            <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-zinc-500 text-center pt-1">
              {t.pwa.appVersionLabel} {APP_VERSION} · {runtimePlatform}
            </p>
          </div>
        ) : (
          <div className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-5 flex flex-col gap-3 shadow-xs dark:shadow-none">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                {t.pwa.sectionTitle}
              </h3>
              <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1 leading-relaxed">
                {t.pwa.sectionDesc}
              </p>
            </div>

            <PWAInstallButton t={t} showManualGuide compact label={t.pwa.directInstallNow} />

            {directShareBlock}

            {onOpenPromoSite && (
              <div className="pt-3 border-t border-[var(--surface-border-subtle)] grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onOpenPromoSite}
                  className={`min-h-[42px] px-3.5 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-amber-500/60 text-xs font-semibold text-slate-900 dark:text-zinc-100 flex items-center justify-center gap-2 cursor-pointer ${
                    promoSiteUrl ? '' : 'sm:col-span-2'
                  }`}
                >
                  <Globe className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>{t.pwa.promoSiteButton}</span>
                </button>
                {promoSiteUrl && (
                  <button
                    type="button"
                    onClick={handleCopyPromoSiteUrl}
                    className="min-h-[42px] px-3.5 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-amber-500/60 text-xs font-semibold text-slate-900 dark:text-zinc-100 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {copiedPromoLink ? (
                      <Check className="w-4 h-4 shrink-0 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    )}
                    <span>{copiedPromoLink ? t.pwa.promoSiteCopied : t.pwa.promoSiteCopy}</span>
                  </button>
                )}
              </div>
            )}

            <PWAUpdateButton t={t} />

            <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-zinc-500 text-center pt-1">
              {t.pwa.appVersionLabel} {APP_VERSION} ·{' '}
              {needRefresh ? t.pwa.statusUpdateAvailable : t.pwa.statusLatest}
            </p>
          </div>
        )}

        {/* Privacy Policy Disclosure Card (Play Store Compliance) */}
        <div className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-4 flex items-start gap-3 shadow-xs dark:shadow-none">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
              {t.settings.privacyPolicyLabel}
            </h3>
            <p className="text-[11px] text-slate-600 dark:text-zinc-400 mt-1 leading-relaxed">
              {t.settings.privacySummary}
            </p>
            {!isNativeShell && (
              <a
                href="/privacy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline"
              >
                {t.settings.privacyPolicyLabel} (HTML)
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }
);
