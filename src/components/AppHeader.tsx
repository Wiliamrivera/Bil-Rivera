import React from 'react';
import { Globe, Home, Music, Settings as SettingsIcon } from 'lucide-react';
import { TranslationDict } from '../i18n/translations';
import { HeaderBrandMode } from '../types/studio';

export type AppTab = 'studio' | 'setlists' | 'settings' | 'playlistTracks' | 'promo';
export const MAIN_TAB_ORDER: Array<'studio' | 'setlists' | 'settings'> = [
  'studio',
  'setlists',
  'settings',
];

interface AppHeaderProps {
  activeTab: AppTab;
  isMobileLandscape: boolean;
  isNativeShell: boolean;
  headerLogoDataUrl?: string;
  headerBrandMode?: HeaderBrandMode;
  t: TranslationDict;
  onNavigateTab: (tab: AppTab) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = React.memo(
  ({
    activeTab,
    isMobileLandscape,
    isNativeShell,
    headerLogoDataUrl,
    headerBrandMode,
    t,
    onNavigateTab,
  }) => {
    const showLogo =
      Boolean(headerLogoDataUrl) &&
      headerLogoDataUrl !== 'none' &&
      (headerBrandMode === 'logo' || headerBrandMode === 'both');
    const showTitle =
      !headerLogoDataUrl || headerLogoDataUrl === 'none' || headerBrandMode !== 'logo';

    return (
      <header className="sticky top-0 z-30 bg-[var(--surface-base-translucent)] backdrop-blur-md border-b border-[var(--surface-border-subtle)] pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div
          className={`max-w-5xl mx-auto px-3 sm:px-6 flex items-center gap-0.5 ${
            isMobileLandscape
              ? 'py-1 flex-row justify-between gap-3'
              : 'pt-1.5 pb-0.5 flex-col justify-center'
          }`}
        >
          <a
            href="#palco"
            onClick={(e) => {
              e.preventDefault();
              onNavigateTab('studio');
            }}
            className={`flex items-center justify-center whitespace-nowrap shrink-0 ${
              isMobileLandscape ? 'flex-row gap-2' : 'flex-col gap-0.5'
            }`}
          >
            {showLogo && (
              <img
                src={headerLogoDataUrl}
                alt={t.appName}
                width={48}
                height={48}
                decoding="async"
                className={
                  isMobileLandscape
                    ? 'w-8 h-8 rounded-lg object-cover bg-black border border-amber-500/35 shadow-sm'
                    : headerBrandMode === 'logo'
                      ? 'w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover bg-black border border-amber-500/35 shadow-sm'
                      : 'w-11 h-11 sm:w-12 sm:h-12 rounded-xl object-cover bg-black border border-amber-500/35 shadow-sm'
                }
              />
            )}
            {showTitle && (
              <span
                className={
                  headerLogoDataUrl &&
                  headerLogoDataUrl !== 'none' &&
                  headerBrandMode === 'both'
                    ? `font-display font-semibold tracking-wide text-slate-700 dark:text-zinc-300 leading-tight ${
                        isMobileLandscape ? 'text-xs' : 'text-[10px] sm:text-[11px]'
                      }`
                    : 'font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-zinc-100'
                }
              >
                {t.appName}
              </span>
            )}
          </a>

          <nav
            className={`flex items-center justify-center ${
              isMobileLandscape ? 'gap-5' : 'gap-7 sm:gap-8'
            }`}
          >
            {MAIN_TAB_ORDER.map((tabKey) => {
              const active =
                activeTab === tabKey || (tabKey === 'studio' && activeTab === 'playlistTracks');
              return (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => onNavigateTab(tabKey)}
                  aria-label={t.tabs[tabKey]}
                  title={t.tabs[tabKey]}
                  className={`min-h-[34px] min-w-[44px] py-1.5 px-3 text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer flex items-center justify-center ${
                    active
                      ? 'border-amber-500 text-amber-700 dark:text-amber-400'
                      : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                  }`}
                >
                  {tabKey === 'studio' ? (
                    <Home className="w-[19px] h-[19px] shrink-0" />
                  ) : tabKey === 'setlists' ? (
                    <Music className="w-[19px] h-[19px] shrink-0" />
                  ) : (
                    <SettingsIcon className="w-[19px] h-[19px] shrink-0" />
                  )}
                </button>
              );
            })}
            {!isNativeShell && (
              <button
                type="button"
                onClick={() => onNavigateTab('promo')}
                aria-label={t.tabs.promo}
                title={t.tabs.promo}
                className="min-h-[34px] min-w-[44px] py-1.5 px-3 text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 border-b-2 border-transparent text-slate-500 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer flex items-center justify-center"
              >
                <Globe className="w-[19px] h-[19px] shrink-0" />
              </button>
            )}
          </nav>
        </div>
      </header>
    );
  }
);

AppHeader.displayName = 'AppHeader';
