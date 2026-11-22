import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Gauge,
  Home,
  Loader2,
  Minus,
  Music,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings as SettingsIcon,
  Share2,
  Sliders,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  detectBpmAndOffset,
  exportTrackAudioToWav,
  formatTimecode,
} from './audio/audioUtils';
import {
  createInitialDemoTracks,
  createInitialSetlists,
  synthesizeDemoWavBlobAsync,
} from './audio/demoTracks';
import { PlaylistSelectorDropdown } from './components/PlaylistSelectorDropdown';
import { PlaylistTrackDropdown } from './components/PlaylistTrackDropdown';
import { PlaylistTracksView } from './components/PlaylistTracksView';
import { AndroidDirectInstallerSheet, OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { SetlistsView } from './components/SetlistsView';
import { SettingsView } from './components/SettingsView';
import { UploadTracksModal, UploadTracksModalHandle } from './components/UploadTracksModal';
import { WaveformCanvas } from './components/WaveformCanvas';
import { usePracticeAudio } from './hooks/usePracticeAudio';
import { TRANSLATIONS } from './i18n/translations';
import {
  DEFAULT_SETTINGS,
  deleteAudioBlobFromDB,
  loadActiveIds,
  loadAudioBlobFromDB,
  loadSavedSetlists,
  loadSavedTracks,
  loadSettings,
  saveActiveIds,
  saveAudioBlobToDB,
  saveAudioBlobsBatchToDB,
  saveSetlists,
  saveSettings,
  saveTracks,
} from './storage/studioStorage';
import {
  AppColorPalette,
  PracticeTrack,
  Setlist,
  SongSection,
  StudioSettings,
  TrackPreset,
} from './types/studio';
import {
  filterPlayableAudioFiles,
  inferAudioMimeType,
  materializeAudioBlob,
} from './utils/audioFileFilter';
import {
  createAudioContextSafe,
  decodeAudioDataSafe,
  isAndroidDevice,
  isHandheldOrTablet,
} from './utils/platform';

const EMPTY_SECTIONS: SongSection[] = [];

const PALETTE_META_THEME_COLORS: Record<AppColorPalette, { dark: string; light: string }> = {
  amber: { dark: '#000000', light: '#F4F5F7' },
  crimson: { dark: '#111219', light: '#F6F4F6' },
  mint: { dark: '#1E2228', light: '#F2F6F4' },
  cobalt: { dark: '#0B0F17', light: '#F2F5FA' },
};

type AppTab = 'studio' | 'setlists' | 'settings' | 'playlistTracks';
const TAB_ORDER: Array<'studio' | 'setlists' | 'settings'> = ['studio', 'setlists', 'settings'];

function readAudioDurationFast(file: File, timeoutMs = 1000): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audioEl = document.createElement('audio');
    audioEl.preload = 'metadata';
    let settled = false;
    const cleanup = (dur: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audioEl.removeAttribute('src');
      audioEl.load();
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(dur) && dur > 0 ? Number(dur.toFixed(2)) : 0);
    };
    const timer = window.setTimeout(() => cleanup(0), timeoutMs);
    audioEl.onloadedmetadata = () => cleanup(audioEl.duration);
    audioEl.onerror = () => cleanup(0);
    audioEl.src = url;
  });
}

function compareTrackTitles(a: PracticeTrack, b: PracticeTrack): number {
  return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
}

function sortTrackIdsByTitle(ids: string[], trackList: PracticeTrack[]): string[] {
  const map = new Map(trackList.map((tr) => [tr.id, tr]));
  return [...ids].sort((a, b) => {
    const ta = map.get(a);
    const tb = map.get(b);
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return compareTrackTitles(ta, tb);
  });
}

function areTracksAlphabetical(list: PracticeTrack[]): boolean {
  if (list.length <= 1) return true;
  for (let i = 1; i < list.length; i++) {
    if (compareTrackTitles(list[i - 1], list[i]) > 0) return false;
  }
  return true;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const FALLBACK_PRESET: TrackPreset = {
  speed: 1,
  pitchSemitones: 0,
  pitchCents: 0,
  volumeL: 1,
  volumeR: 1,
  bpm: 100,
  beatsPerBar: 4,
  beatOffset: 0,
  loopA: null,
  loopB: null,
  loopEnabled: false,
  lastPosition: 0,
};

const DEMO_LR_MIGRATION_KEY = 'riffforge_demo_lr_v1';

function loadInitialStudioData() {
  const demoDefaults = createInitialDemoTracks();
  const demoById = new Map(demoDefaults.map((tr) => [tr.id, tr]));

  let baseTracks = loadSavedTracks() || demoDefaults;
  let loadedSetlists = loadSavedSetlists() || createInitialSetlists();
  const activeIds = loadActiveIds();
  let nextInitialTrackId =
    activeIds.trackId === 'demo-blues-a' ? 'demo-worship-g' : activeIds.trackId;

  let needsDemoMigration = false;
  try {
    needsDemoMigration =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(DEMO_LR_MIGRATION_KEY) !== '1';
  } catch {
    needsDemoMigration = false;
  }

  if (needsDemoMigration) {
    let tracksChanged = false;
    const seenTrackIds = new Set<string>();
    const upgradedTracks: PracticeTrack[] = [];

    for (const tr of baseTracks) {
      if (tr.id === 'demo-rock-em' && tr.source === 'builtin') {
        upgradedTracks.push(demoById.get('demo-rock-em')!);
        seenTrackIds.add('demo-rock-em');
        tracksChanged = true;
      } else if ((tr.id === 'demo-blues-a' || tr.id === 'demo-worship-g') && tr.source === 'builtin') {
        upgradedTracks.push(demoById.get('demo-worship-g')!);
        seenTrackIds.add('demo-worship-g');
        tracksChanged = true;
      } else if (tr.id === 'demo-funk-dm' && tr.source === 'builtin') {
        upgradedTracks.push(demoById.get('demo-funk-dm')!);
        seenTrackIds.add('demo-funk-dm');
        tracksChanged = true;
      } else {
        upgradedTracks.push(tr);
        seenTrackIds.add(tr.id);
      }
    }

    const hadPracticeSetlist = loadedSetlists.some(
      (sl) => sl.id === 'setlist-practice' && sl.name === 'Estudo Diário'
    );
    if (hadPracticeSetlist) {
      for (const demoTr of demoDefaults) {
        if (!seenTrackIds.has(demoTr.id)) {
          upgradedTracks.push(demoTr);
          seenTrackIds.add(demoTr.id);
          tracksChanged = true;
        }
      }
    }

    if (tracksChanged) {
      baseTracks = upgradedTracks;
      saveTracks(baseTracks);
    }

    let setlistsChanged = false;
    loadedSetlists = loadedSetlists.map((sl) => {
      const mappedIds = sl.trackIds.map((id) => (id === 'demo-blues-a' ? 'demo-worship-g' : id));
      const mappedPrev = sl.previousTrackIds?.map((id) =>
        id === 'demo-blues-a' ? 'demo-worship-g' : id
      );
      let nextSl = sl;
      if (sl.id === 'setlist-practice') {
        const isLegacyName = sl.name === 'Estudo Diário';
        const ensureDemos = isLegacyName
          ? Array.from(new Set([...mappedIds, ...demoDefaults.map((d) => d.id)]))
          : mappedIds;
        const orderedDemos = sl.isCustomOrder
          ? ensureDemos
          : sortTrackIdsByTitle(ensureDemos, baseTracks);
        if (
          isLegacyName ||
          !arraysEqual(orderedDemos, sl.trackIds) ||
          (mappedPrev && sl.previousTrackIds && !arraysEqual(mappedPrev, sl.previousTrackIds))
        ) {
          setlistsChanged = true;
          nextSl = {
            ...sl,
            name: isLegacyName ? 'Demo' : sl.name,
            description: isLegacyName
              ? 'Músicas de referência V/S em L/R (L: Click · R: Música)'
              : sl.description,
            trackIds: orderedDemos,
            previousTrackIds: mappedPrev,
          };
        }
      } else if (!arraysEqual(mappedIds, sl.trackIds)) {
        setlistsChanged = true;
        nextSl = { ...sl, trackIds: mappedIds, previousTrackIds: mappedPrev };
      }
      return nextSl;
    });

    if (setlistsChanged) {
      saveSetlists(loadedSetlists);
    }

    try {
      localStorage.setItem(DEMO_LR_MIGRATION_KEY, '1');
    } catch {
      // ignore storage restrictions
    }
  }

  const migratedSetlists = loadedSetlists.map((sl) => {
    if (sl.isCustomOrder !== undefined) return sl;
    const sorted = sortTrackIdsByTitle(sl.trackIds, baseTracks);
    const changed = !arraysEqual(sorted, sl.trackIds);
    return {
      ...sl,
      trackIds: sorted,
      previousTrackIds: changed ? sl.trackIds : sl.previousTrackIds,
      isCustomOrder: false,
    };
  });
  const savedSettings = loadSettings();
  const initialTrackId =
    nextInitialTrackId && baseTracks.some((tr) => tr.id === nextInitialTrackId)
      ? nextInitialTrackId
      : baseTracks[0]?.id || '';
  const rawSetlistId = activeIds.setlistId;
  const initialSetlistId =
    rawSetlistId === 'all' || (rawSetlistId && migratedSetlists.some((sl) => sl.id === rawSetlistId))
      ? rawSetlistId
      : migratedSetlists.some((sl) => sl.id === 'setlist-practice')
        ? 'setlist-practice'
        : migratedSetlists[0]?.id || 'all';
  return { baseTracks, migratedSetlists, savedSettings, initialTrackId, initialSetlistId };
}

export default function App() {
  const initialData = useMemo(() => loadInitialStudioData(), []);
  const [tracks, setTracks] = useState<PracticeTrack[]>(initialData.baseTracks);
  const [setlists, setSetlists] = useState<Setlist[]>(initialData.migratedSetlists);
  const [settings, setSettings] = useState<StudioSettings>(initialData.savedSettings);
  const activeTheme = settings.theme === 'light' ? 'light' : 'dark';
  const activePalette: AppColorPalette =
    settings.colorPalette === 'crimson' ||
    settings.colorPalette === 'mint' ||
    settings.colorPalette === 'cobalt'
      ? settings.colorPalette
      : 'amber';
  const [activeTrackId, setActiveTrackId] = useState<string>(initialData.initialTrackId);
  const [activeSetlistId, setActiveSetlistId] = useState<string>(initialData.initialSetlistId);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('dark', activeTheme === 'dark');
    if (activePalette === 'amber') {
      root.removeAttribute('data-palette');
    } else {
      root.setAttribute('data-palette', activePalette);
    }
    root.style.colorScheme = activeTheme;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', PALETTE_META_THEME_COLORS[activePalette][activeTheme]);
    }
  }, [activePalette, activeTheme]);

  const [activeTab, setActiveTab] = useState<AppTab>('studio');
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{
    current: number;
    total: number;
    fileName: string;
  } | null>(null);
  const [importSuccessCount, setImportSuccessCount] = useState<number | null>(null);
  const [importErrorNotice, setImportErrorNotice] = useState<string | null>(null);
  const [previousAllTrackIds, setPreviousAllTrackIds] = useState<string[] | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [readyExport, setReadyExport] = useState<{ blob: Blob; fileName: string; url: string } | null>(null);
  const [showPitchPanel, setShowPitchPanel] = useState(false);
  const [showBpmPanel, setShowBpmPanel] = useState(false);
  const [pendingDeleteTrack, setPendingDeleteTrack] = useState<PracticeTrack | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showExitNotice, setShowExitNotice] = useState(false);
  const [bootSplashDone, setBootSplashDone] = useState<boolean>(
    () => typeof document !== 'undefined' && !document.getElementById('rivera-boot-splash')
  );

  const uploadModalRef = useRef<UploadTracksModalHandle | null>(null);
  const importSuccessTimerRef = useRef<number | null>(null);
  const importErrorTimerRef = useRef<number | null>(null);
  const exportCleanupTimerRef = useRef<number | null>(null);
  const exitNoticeTimerRef = useRef<number | null>(null);
  const exitArmedUntilRef = useRef<number>(0);
  const importRunningRef = useRef<boolean>(false);
  const activeTabRef = useRef<AppTab>(activeTab);
  activeTabRef.current = activeTab;
  const pendingDeleteTrackRef = useRef<PracticeTrack | null>(pendingDeleteTrack);
  pendingDeleteTrackRef.current = pendingDeleteTrack;
  const readyExportRef = useRef(readyExport);
  readyExportRef.current = readyExport;
  const showUploadModalRef = useRef(showUploadModal);
  showUploadModalRef.current = showUploadModal;
  const sessionEditedSetlistsRef = useRef<Set<string>>(new Set());
  const allTracksCustomOrderRef = useRef<boolean>(false);
  const demoBlobCacheRef = useRef<Map<string, Blob>>(new Map());
  const blobCacheRef = useRef<Map<string, Blob>>(new Map());
  const inflightBlobRef = useRef<Map<string, Promise<Blob | null>>>(new Map());
  const prevVolLRef = useRef<number>(1);
  const prevVolRRef = useRef<number>(1);
  const autoPlayOnLoadRef = useRef<boolean>(false);
  const lastPrevClickRef = useRef<number>(0);
  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const ensureHistoryGuard = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      if (!window.history.state || window.history.state.riveraGuard !== true) {
        window.history.pushState({ riveraGuard: true }, '');
      }
    } catch {
      // ignore restricted history environments
    }
  }, []);

  const clearExitPrompt = useCallback(() => {
    exitArmedUntilRef.current = 0;
    if (exitNoticeTimerRef.current !== null) {
      window.clearTimeout(exitNoticeTimerRef.current);
      exitNoticeTimerRef.current = null;
    }
    setShowExitNotice(false);
  }, []);

  const navigateToTab = useCallback(
    (nextTab: AppTab) => {
      clearExitPrompt();
      setActiveTab(nextTab);
      if (nextTab !== 'studio') {
        ensureHistoryGuard();
      }
    },
    [clearExitPrompt, ensureHistoryGuard]
  );

  // Android hardware / gesture Back button interception:
  // - Closes open modal if one is open
  // - From any non-home view (Playlist, Settings, or Playlist Tracks), returns to V/S main screen
  // - On V/S main screen, 1st press warns & waits 2.2s; 2nd press within 2.2s closes the app
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (!window.history.state) {
        window.history.replaceState({ riveraRoot: true }, '');
      }
      ensureHistoryGuard();
    } catch {
      // ignore
    }

    const onUserInteract = () => {
      if (Date.now() >= exitArmedUntilRef.current) {
        ensureHistoryGuard();
      }
    };

    const onPopState = () => {
      if (pendingDeleteTrackRef.current) {
        setPendingDeleteTrack(null);
        ensureHistoryGuard();
        return;
      }
      if (readyExportRef.current) {
        URL.revokeObjectURL(readyExportRef.current.url);
        setReadyExport(null);
        ensureHistoryGuard();
        return;
      }
      if (showUploadModalRef.current) {
        setShowUploadModal(false);
        ensureHistoryGuard();
        return;
      }
      if (activeTabRef.current !== 'studio') {
        clearExitPrompt();
        setActiveTab('studio');
        ensureHistoryGuard();
        return;
      }

      if (Date.now() < exitArmedUntilRef.current) {
        clearExitPrompt();
        return;
      }

      exitArmedUntilRef.current = Date.now() + 2200;
      setShowExitNotice(true);
      if (exitNoticeTimerRef.current !== null) {
        window.clearTimeout(exitNoticeTimerRef.current);
      }
      exitNoticeTimerRef.current = window.setTimeout(() => {
        exitNoticeTimerRef.current = null;
        exitArmedUntilRef.current = 0;
        setShowExitNotice(false);
        ensureHistoryGuard();
      }, 2200);
    };

    window.addEventListener('pointerdown', onUserInteract, { capture: true, passive: true });
    window.addEventListener('keydown', onUserInteract, { capture: true });
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('pointerdown', onUserInteract, true);
      window.removeEventListener('keydown', onUserInteract, true);
      window.removeEventListener('popstate', onPopState);
      if (exitNoticeTimerRef.current !== null) {
        window.clearTimeout(exitNoticeTimerRef.current);
        exitNoticeTimerRef.current = null;
      }
    };
  }, [clearExitPrompt, ensureHistoryGuard]);

  useEffect(() => {
    if (showUploadModal || pendingDeleteTrack || readyExport) {
      clearExitPrompt();
      ensureHistoryGuard();
    }
  }, [clearExitPrompt, ensureHistoryGuard, pendingDeleteTrack, readyExport, showUploadModal]);

  const isMobileClient = useMemo(() => isHandheldOrTablet(), []);

  const isAndroidClient = useMemo(() => isAndroidDevice(), []);

  useEffect(() => {
    const splash = document.getElementById('rivera-boot-splash');
    if (!splash) {
      setBootSplashDone(true);
      return;
    }

    const splashVideo = document.getElementById('rivera-boot-splash-video') as HTMLVideoElement | null;
    const splashFallback = document.getElementById('rivera-boot-splash-fallback') as HTMLImageElement | null;
    const bootState = (window as unknown as {
      __riveraBootVideoState?: { ended?: boolean; error?: boolean; blocked?: boolean; started?: boolean };
    }).__riveraBootVideoState;

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
          // ignore
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

    const onVideoEnded = () => {
      startFadeOut();
    };

    const onVideoError = () => {
      showFallbackAndExit(260);
    };

    const onLoadedMetadata = () => {
      if (cancelled || dismissed) return;
      if (Number.isFinite(splashVideo.duration) && splashVideo.duration > 0) {
        window.clearTimeout(safetyTimer);
        const capMs = Math.min(11500, Math.ceil(splashVideo.duration * 1000) + 1200);
        safetyTimer = window.setTimeout(startFadeOut, capMs);
      }
    };

    // Allow user to tap anywhere on splash after 400ms to enter immediately
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

    // Watchdog: if video still hasn't rendered or started playing within 1.4s (e.g. offline/iOS blocked), exit smoothly
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
      window.screen as unknown as {
        orientation?: {
          type?: string;
          unlock?: () => void;
          addEventListener?: (type: string, listener: () => void) => void;
          removeEventListener?: (type: string, listener: () => void) => void;
        };
      }
    )?.orientation;

    // Ensure WebView / standalone window never keeps an implicit JS orientation lock
    try {
      screenOrientation?.unlock?.();
    } catch {
      // Ignore on browsers that restrict orientation.unlock outside fullscreen
    }

    const mq = window.matchMedia('(orientation: landscape)');
    let settleTimer: number | null = null;

    const readIsLandscape = (): boolean => {
      const activeTag = document.activeElement?.tagName;
      const isEditingText = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
      const screenType = screenOrientation?.type;

      if (typeof screenType === 'string' && screenType.length > 0) {
        if (isEditingText) {
          return screenType.startsWith('landscape');
        }
        return screenType.startsWith('landscape') || window.innerWidth > window.innerHeight;
      }

      const legacyAngle = (window as unknown as { orientation?: number }).orientation;
      if (typeof legacyAngle === 'number') {
        if (isEditingText) {
          return Math.abs(legacyAngle) === 90;
        }
        return Math.abs(legacyAngle) === 90 || mq.matches || window.innerWidth > window.innerHeight;
      }

      return mq.matches || window.innerWidth > window.innerHeight;
    };

    const syncOrientation = () => {
      setIsMobileLandscape(readIsLandscape());
    };

    const handleOrientationChange = () => {
      syncOrientation();
      window.requestAnimationFrame(syncOrientation);
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
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
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
      window.removeEventListener('resize', syncOrientation);
      window.removeEventListener('orientationchange', handleOrientationChange);
      mq.removeEventListener?.('change', syncOrientation);
      screenOrientation?.removeEventListener?.('change', handleOrientationChange);
    };
  }, [isMobileClient]);

  const readyExportUrlRef = useRef<string | null>(null);
  readyExportUrlRef.current = readyExport?.url ?? null;

  useEffect(() => {
    return () => {
      if (importSuccessTimerRef.current !== null) {
        window.clearTimeout(importSuccessTimerRef.current);
      }
      if (importErrorTimerRef.current !== null) {
        window.clearTimeout(importErrorTimerRef.current);
      }
      if (exportCleanupTimerRef.current !== null) {
        window.clearTimeout(exportCleanupTimerRef.current);
      }
      if (readyExportUrlRef.current) {
        URL.revokeObjectURL(readyExportUrlRef.current);
      }
    };
  }, []);

  const t = TRANSLATIONS[settings.language];

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const setlistsRef = useRef(setlists);
  setlistsRef.current = setlists;
  const activeSetlistIdRef = useRef(activeSetlistId);
  activeSetlistIdRef.current = activeSetlistId;

  const activeTrack = useMemo(
    () => tracks.find((tr) => tr.id === activeTrackId) || tracks[0],
    [activeTrackId, tracks]
  );

  const activeSetlistTracks = useMemo(() => {
    if (activeSetlistId === 'all') return tracks;
    const sl = setlists.find((s) => s.id === activeSetlistId);
    if (!sl) return tracks;
    const trackMap = new Map(tracks.map((tr) => [tr.id, tr]));
    return sl.trackIds
      .map((id) => trackMap.get(id))
      .filter((tr): tr is PracticeTrack => Boolean(tr));
  }, [activeSetlistId, setlists, tracks]);

  const currentTrackIndex = activeTrack
    ? activeSetlistTracks.findIndex((tr) => tr.id === activeTrack.id)
    : -1;

  const lastSavedStateRef = useRef({
    tracks,
    setlists,
    settings,
    activeTrackId,
    activeSetlistId,
  });

  // Debounced persistence so slider drags & updates never stutter the main thread
  useEffect(() => {
    const id = window.setTimeout(() => {
      saveTracks(tracks);
      lastSavedStateRef.current.tracks = tracks;
    }, 200);
    return () => window.clearTimeout(id);
  }, [tracks]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      saveSetlists(setlists);
      lastSavedStateRef.current.setlists = setlists;
    }, 200);
    return () => window.clearTimeout(id);
  }, [setlists]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      saveSettings(settings);
      lastSavedStateRef.current.settings = settings;
    }, 200);
    return () => window.clearTimeout(id);
  }, [settings]);

  const resolvedActiveTrackId = activeTrack?.id;
  useEffect(() => {
    if (resolvedActiveTrackId) {
      saveActiveIds(resolvedActiveTrackId, activeSetlistId);
      lastSavedStateRef.current.activeTrackId = resolvedActiveTrackId;
      lastSavedStateRef.current.activeSetlistId = activeSetlistId;
    }
  }, [resolvedActiveTrackId, activeSetlistId]);

  // Flush only modified stores when mobile browser suspends/closes tab
  const latestStateRef = useRef({ tracks, setlists, settings, activeTrackId, activeSetlistId });
  latestStateRef.current = { tracks, setlists, settings, activeTrackId, activeSetlistId };

  useEffect(() => {
    const flush = () => {
      const s = latestStateRef.current;
      const saved = lastSavedStateRef.current;
      if (saved.tracks !== s.tracks) {
        saveTracks(s.tracks);
        saved.tracks = s.tracks;
      }
      if (saved.setlists !== s.setlists) {
        saveSetlists(s.setlists);
        saved.setlists = s.setlists;
      }
      if (saved.settings !== s.settings) {
        saveSettings(s.settings);
        saved.settings = s.settings;
      }
      if (
        saved.activeTrackId !== s.activeTrackId ||
        saved.activeSetlistId !== s.activeSetlistId
      ) {
        saveActiveIds(s.activeTrackId, s.activeSetlistId);
        saved.activeTrackId = s.activeTrackId;
        saved.activeSetlistId = s.activeSetlistId;
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const maxBlobCache = isMobileClient ? 24 : 48;

  const resolveTrackBlob = useCallback(
    async (id: string): Promise<Blob | null> => {
      const tr = tracksRef.current.find((item) => item.id === id);
      if (!tr) return null;

      if (tr.source === 'builtin' && tr.builtinKey) {
        const cached = demoBlobCacheRef.current.get(tr.builtinKey);
        if (cached) return cached;
      } else {
        const blobCache = blobCacheRef.current;
        const cachedLocal = blobCache.get(id);
        if (cachedLocal) {
          blobCache.delete(id);
          blobCache.set(id, cachedLocal);
          return cachedLocal;
        }
      }

      const inflight = inflightBlobRef.current.get(id);
      if (inflight) {
        return inflight;
      }

      const task = (async (): Promise<Blob | null> => {
        if (tr.source === 'builtin' && tr.builtinKey) {
          const cached = demoBlobCacheRef.current.get(tr.builtinKey);
          if (cached) return cached;
          const wav = await synthesizeDemoWavBlobAsync(tr.builtinKey);
          demoBlobCacheRef.current.set(tr.builtinKey, wav);
          return wav;
        }

        const stored = await loadAudioBlobFromDB(id);
        if (stored) {
          const blobCache = blobCacheRef.current;
          while (blobCache.size >= maxBlobCache) {
            const oldest = blobCache.keys().next().value;
            if (oldest === undefined) break;
            blobCache.delete(oldest);
          }
          blobCache.set(id, stored);
        }
        return stored;
      })().finally(() => {
        inflightBlobRef.current.delete(id);
      });

      inflightBlobRef.current.set(id, task);
      return task;
    },
    [maxBlobCache]
  );

  const nextTrackInSetlist = useMemo(() => {
    if (activeSetlistTracks.length <= 1 || currentTrackIndex < 0) return null;
    if (currentTrackIndex >= activeSetlistTracks.length - 1) {
      if (settings.autoAdvance) return null;
      const wrapped = activeSetlistTracks[0];
      return wrapped && wrapped.id !== activeTrack?.id ? wrapped : null;
    }
    const candidate = activeSetlistTracks[currentTrackIndex + 1];
    return candidate && candidate.id !== activeTrack?.id ? candidate : null;
  }, [activeSetlistTracks, activeTrack?.id, currentTrackIndex, settings.autoAdvance]);

  const activeTrackIdRef = useRef(activeTrackId);
  activeTrackIdRef.current = activeTrackId;

  const updateActiveTrack = useCallback(
    (updater: (track: PracticeTrack) => PracticeTrack) => {
      const targetId = activeTrackIdRef.current;
      setTracks((prev) => prev.map((tr) => (tr.id === targetId ? updater(tr) : tr)));
    },
    []
  );

  const updatePreset = useCallback(
    (patch: Partial<TrackPreset>) => {
      updateActiveTrack((tr) => ({
        ...tr,
        preset: { ...tr.preset, ...patch },
      }));
    },
    [updateActiveTrack]
  );

  const handlePersistPos = useCallback(
    (pos: number) => {
      updatePreset({ lastPosition: Number(pos.toFixed(2)) });
    },
    [updatePreset]
  );

  const autoAdvanceRef = useRef(settings.autoAdvance);
  autoAdvanceRef.current = settings.autoAdvance;
  const activeSetlistTracksRef = useRef(activeSetlistTracks);
  activeSetlistTracksRef.current = activeSetlistTracks;

  const handleTrackEnded = useCallback(() => {
    if (!autoAdvanceRef.current) return;
    const list = activeSetlistTracksRef.current;
    if (list.length === 0) return;

    const currentIdx = list.findIndex((tr) => tr.id === activeTrackIdRef.current);
    if (currentIdx >= 0 && currentIdx < list.length - 1) {
      autoPlayOnLoadRef.current = true;
      setActiveTrackId(list[currentIdx + 1].id);
    } else if (currentIdx === -1 && list.length > 0 && list[0].id !== activeTrackIdRef.current) {
      autoPlayOnLoadRef.current = true;
      setActiveTrackId(list[0].id);
    }
  }, []);

  const handleAutoAdvancedTrack = useCallback((nextId: string) => {
    const prevId = activeTrackIdRef.current;
    if (prevId && prevId !== nextId) {
      setTracks((prev) =>
        prev.map((tr) =>
          tr.id === prevId && tr.preset.lastPosition !== 0
            ? { ...tr, preset: { ...tr.preset, lastPosition: 0 } }
            : tr
        )
      );
    }
    setActiveTrackId(nextId);
  }, []);

  const audio = usePracticeAudio({
    trackId: activeTrack?.id,
    resolveBlob: resolveTrackBlob,
    nextTrackId: nextTrackInSetlist?.id ?? null,
    nextPreset: nextTrackInSetlist?.preset ?? null,
    autoAdvance: Boolean(settings.autoAdvance),
    isMobile: isMobileClient,
    deferLoad: !bootSplashDone,
    preset: activeTrack?.preset ?? FALLBACK_PRESET,
    settings,
    autoPlayOnLoadRef,
    onTimeUpdatePersist: handlePersistPos,
    onAutoAdvancedTrack: handleAutoAdvancedTrack,
    onTrackEnded: handleTrackEnded,
  });

  const activeTrackDuration = activeTrack?.duration;
  useEffect(() => {
    if (
      resolvedActiveTrackId &&
      typeof activeTrackDuration === 'number' &&
      audio.duration > 0 &&
      Math.abs(audio.duration - activeTrackDuration) > 0.2
    ) {
      updateActiveTrack((tr) => ({ ...tr, duration: Number(audio.duration.toFixed(2)) }));
    }
  }, [resolvedActiveTrackId, activeTrackDuration, audio.duration, updateActiveTrack]);

  // Smart prioritized pre-decoding around the active song & playlist so any selection or Auto-Advance triggers immediately
  const prefetchTracks = audio.prefetchTracks;
  useEffect(() => {
    if (!bootSplashDone || isImporting) return;
    if (activeTab !== 'studio' && activeTab !== 'playlistTracks' && activeTab !== 'setlists') return;
    if (activeSetlistTracks.length === 0) return;

    let cancelPrefetch: (() => void) | null = null;
    const delayMs = activeTab === 'studio' ? 140 : 40;
    const timer = window.setTimeout(() => {
      const len = activeSetlistTracks.length;
      const baseIdx = currentTrackIndex >= 0 ? currentTrackIndex : 0;
      const orderedIds: string[] = [];
      const seen = new Set<string>();
      const pushIdx = (idx: number) => {
        if (idx < 0 || idx >= len) return;
        const id = activeSetlistTracks[idx]?.id;
        if (id && !seen.has(id)) {
          seen.add(id);
          orderedIds.push(id);
        }
      };

      pushIdx((baseIdx + 1) % len);
      pushIdx((baseIdx - 1 + len) % len);
      pushIdx((baseIdx + 2) % len);
      pushIdx((baseIdx + 3) % len);
      for (let i = 0; i < len && orderedIds.length < (isMobileClient ? 9 : 14); i++) {
        pushIdx(i);
      }

      if (orderedIds.length > 0) {
        cancelPrefetch = prefetchTracks(orderedIds);
      }
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
      cancelPrefetch?.();
    };
  }, [
    bootSplashDone,
    isImporting,
    activeTab,
    activeSetlistTracks,
    currentTrackIndex,
    isMobileClient,
    prefetchTracks,
  ]);

  const showImportError = useCallback((message: string) => {
    if (importErrorTimerRef.current !== null) {
      window.clearTimeout(importErrorTimerRef.current);
    }
    setImportErrorNotice(message);
    importErrorTimerRef.current = window.setTimeout(() => {
      setImportErrorNotice(null);
      importErrorTimerRef.current = null;
    }, 4500);
  }, []);

  const handlePreparingImport = useCallback(
    (count?: number) => {
      if (importSuccessTimerRef.current !== null) {
        window.clearTimeout(importSuccessTimerRef.current);
        importSuccessTimerRef.current = null;
      }
      if (importErrorTimerRef.current !== null) {
        window.clearTimeout(importErrorTimerRef.current);
        importErrorTimerRef.current = null;
      }
      setImportSuccessCount(null);
      setImportErrorNotice(null);
      setIsImporting(true);
      setImportStatus({
        current: 0,
        total: count || 0,
        fileName: t.uploadModal.preparingFiles,
      });
    },
    [t.uploadModal.preparingFiles]
  );

  const handleImportEmpty = useCallback(
    (message: string) => {
      setIsImporting(false);
      setImportStatus(null);
      showImportError(message);
    },
    [showImportError]
  );

  const handleImportFiles = useCallback(
    async (files: FileList | File[]) => {
      if (importRunningRef.current) return;
      importRunningRef.current = true;

      let audioFiles: File[] = [];
      try {
        audioFiles = await filterPlayableAudioFiles(Array.from(files));
      } catch {
        audioFiles = Array.from(files);
      }

      if (audioFiles.length === 0) {
        importRunningRef.current = false;
        setIsImporting(false);
        setImportStatus(null);
        showImportError(t.uploadModal.uploadEmptyError);
        return;
      }

      if (importSuccessTimerRef.current !== null) {
        window.clearTimeout(importSuccessTimerRef.current);
        importSuccessTimerRef.current = null;
      }
      if (importErrorTimerRef.current !== null) {
        window.clearTimeout(importErrorTimerRef.current);
        importErrorTimerRef.current = null;
      }
      setImportSuccessCount(null);
      setImportErrorNotice(null);
      setIsImporting(true);
      setImportStatus({
        current: 1,
        total: audioFiles.length,
        fileName: audioFiles[0].name.replace(/\.[^/.]+$/, ''),
      });

      const targetSetlistId = activeSetlistIdRef.current;
      // Only run full PCM decode + BPM detection at upload time for small selections (<= 5 files).
      // Large batches read fast <audio> metadata and save directly to IndexedDB to avoid OOM/freezes.
      const useLightMetadata = audioFiles.length > 5;
      let ctx: AudioContext | null = null;
      if (!useLightMetadata) {
        ctx = createAudioContextSafe();
      }

      let totalCreated = 0;
      let storageWriteFailures = 0;
      let firstCreatedId: string | null = null;
      const runningTracksPool: PracticeTrack[] = [...tracksRef.current];
      const BATCH_SIZE = 4;
      let pendingTracks: PracticeTrack[] = [];
      let pendingBlobs: Array<{ id: string; blob: Blob }> = [];

      const flushChunk = async () => {
        if (pendingTracks.length === 0) return;
        const tracksToCommit = pendingTracks;
        const blobsToSave = pendingBlobs;
        pendingTracks = [];
        pendingBlobs = [];

        const savedIds = new Set<string>();
        try {
          await saveAudioBlobsBatchToDB(blobsToSave);
          for (const item of blobsToSave) savedIds.add(item.id);
        } catch {
          for (const item of blobsToSave) {
            try {
              await saveAudioBlobToDB(item.id, item.blob);
              savedIds.add(item.id);
            } catch (singleErr) {
              storageWriteFailures += 1;
              console.warn('Could not persist track blob:', item.id, singleErr);
            }
          }
        }

        const persistedTracks = tracksToCommit.filter((tr) => savedIds.has(tr.id));
        if (persistedTracks.length === 0) return;

        // Keep bounded compressed audio blobs in RAM
        const cache = blobCacheRef.current;
        for (const item of blobsToSave) {
          if (!savedIds.has(item.id)) continue;
          while (cache.size >= maxBlobCache) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
          }
          cache.set(item.id, item.blob);
        }

        const orderedChunk = [...persistedTracks].sort(compareTrackTitles);
        const chunkIds = orderedChunk.map((tr) => tr.id);
        runningTracksPool.push(...orderedChunk);
        const poolSnapshot = [...runningTracksPool];

        setTracks((prev) => {
          const merged = [...orderedChunk, ...prev];
          return allTracksCustomOrderRef.current ? merged : merged.sort(compareTrackTitles);
        });

        if (targetSetlistId !== 'all') {
          setSetlists((prev) =>
            prev.map((sl) => {
              if (sl.id !== targetSetlistId) return sl;
              const combinedIds = [...sl.trackIds, ...chunkIds];
              return {
                ...sl,
                trackIds: sl.isCustomOrder
                  ? combinedIds
                  : sortTrackIdsByTitle(combinedIds, poolSnapshot),
              };
            })
          );
        }

        if (!firstCreatedId) {
          firstCreatedId = chunkIds[0];
          setActiveTrackId(firstCreatedId);
          saveActiveIds(firstCreatedId, targetSetlistId);
        }

        totalCreated += persistedTracks.length;
      };

      try {
        const MAX_UPFRONT_DECODE_BYTES = 45 * 1024 * 1024;
        if (useLightMetadata) {
          const META_CONCURRENCY = 4;
          for (let i = 0; i < audioFiles.length; i += META_CONCURRENCY) {
            const slice = audioFiles.slice(i, i + META_CONCURRENCY);
            const firstTitle = slice[0].name.replace(/\.[^/.]+$/, '');
            setImportStatus({
              current: Math.min(i + slice.length, audioFiles.length),
              total: audioFiles.length,
              fileName: firstTitle,
            });
            await new Promise<void>((r) => window.setTimeout(r, 0));

            const durations = await Promise.all(
              slice.map((file) => readAudioDurationFast(file, 650).catch(() => 0))
            );
            const blobs = await Promise.all(
              slice.map((file) => materializeAudioBlob(file))
            );
            const nowBase = Date.now();
            for (let j = 0; j < slice.length; j++) {
              const file = slice[j];
              const cleanTitle =
                file.name.replace(/\.[^/.]+$/, '') || `Track ${i + j + 1}`;
              const idx = i + j;
              const id = `local-${nowBase}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
              pendingBlobs.push({ id, blob: blobs[j] });
              pendingTracks.push({
                id,
                title: cleanTitle,
                artist: 'VS / Palco',
                duration: durations[j] || 0,
                source: 'local',
                mimeType: inferAudioMimeType(file.name, file.type),
                preset: {
                  speed: 1,
                  pitchSemitones: 0,
                  pitchCents: 0,
                  volumeL: 1,
                  volumeR: 1,
                  bpm: 120,
                  beatsPerBar: 4,
                  beatOffset: 0,
                  loopA: null,
                  loopB: null,
                  loopEnabled: false,
                  lastPosition: 0,
                },
                sections: [],
                lyricsRaw: '',
                notes: '',
                createdAt: nowBase + idx,
              });
            }

            if (pendingTracks.length >= BATCH_SIZE) {
              await flushChunk();
            }
          }
        } else {
          for (let i = 0; i < audioFiles.length; i++) {
            const file = audioFiles[i];
            const cleanTitle =
              file.name.replace(/\.[^/.]+$/, '') || `Track ${i + 1}`;
            setImportStatus({
              current: i + 1,
              total: audioFiles.length,
              fileName: cleanTitle,
            });
            await new Promise<void>((r) => window.setTimeout(r, 0));

            try {
              const id = `local-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
              const mimeType = inferAudioMimeType(file.name, file.type);
              let duration = 0;
              let bpm = 120;
              let beatOffset = 0;
              let standaloneBlob: Blob;

              let rawArrBuf: ArrayBuffer | null = null;
              try {
                rawArrBuf = await file.arrayBuffer();
                standaloneBlob = new Blob([rawArrBuf], { type: mimeType });
              } catch {
                standaloneBlob = file;
              }

              if (ctx && rawArrBuf && file.size <= MAX_UPFRONT_DECODE_BYTES) {
                try {
                  const decoded = await decodeAudioDataSafe(ctx, rawArrBuf.slice(0));
                  duration = Number(decoded.duration.toFixed(2));
                  const detected = detectBpmAndOffset(decoded);
                  bpm = detected.bpm;
                  beatOffset = detected.beatOffset;
                } catch {
                  duration = await readAudioDurationFast(file);
                }
              } else {
                duration = await readAudioDurationFast(file);
              }

              pendingBlobs.push({ id, blob: standaloneBlob });
              pendingTracks.push({
                id,
                title: cleanTitle,
                artist: 'VS / Palco',
                duration,
                source: 'local',
                mimeType,
                preset: {
                  speed: 1,
                  pitchSemitones: 0,
                  pitchCents: 0,
                  volumeL: 1,
                  volumeR: 1,
                  bpm,
                  beatsPerBar: 4,
                  beatOffset,
                  loopA: null,
                  loopB: null,
                  loopEnabled: false,
                  lastPosition: 0,
                },
                sections: [],
                lyricsRaw: '',
                notes: '',
                createdAt: Date.now() + i,
              });

              if (pendingTracks.length >= BATCH_SIZE) {
                await flushChunk();
              }
            } catch (fileErr) {
              console.warn('Skipping unreadable audio file:', file.name, fileErr);
            }
          }
        }

        await flushChunk();

        if (totalCreated > 0) {
          setActiveTab((curr) =>
            curr === 'setlists' || curr === 'playlistTracks' ? curr : 'studio'
          );
          setImportSuccessCount(totalCreated);
          importSuccessTimerRef.current = window.setTimeout(() => {
            setImportSuccessCount(null);
            importSuccessTimerRef.current = null;
          }, 2800);
        } else if (storageWriteFailures > 0) {
          showImportError(t.uploadModal.uploadStorageError);
        } else {
          showImportError(t.uploadModal.uploadEmptyError);
        }
      } catch (err) {
        console.error('Error importing audio:', err);
        if (totalCreated === 0) {
          showImportError(
            storageWriteFailures > 0
              ? t.uploadModal.uploadStorageError
              : t.uploadModal.uploadEmptyError
          );
        }
      } finally {
        if (ctx) {
          ctx.close().catch(() => {});
        }
        importRunningRef.current = false;
        setIsImporting(false);
        setImportStatus(null);
      }
    },
    [maxBlobCache, showImportError, t.uploadModal.uploadEmptyError, t.uploadModal.uploadStorageError]
  );

  // Setlist & Track Actions
  const handleCreateSetlist = useCallback((name: string) => {
    const id = `setlist-${Date.now()}`;
    setSetlists((prev) => [...prev, { id, name, description: '', trackIds: [], isCustomOrder: false }]);
    setActiveSetlistId(id);
    saveActiveIds(activeTrackIdRef.current, id);
  }, []);

  const handleDeleteSetlist = useCallback((id: string) => {
    sessionEditedSetlistsRef.current.delete(id);
    const next = setlistsRef.current.filter((s) => s.id !== id);
    setSetlists(next);
    saveSetlists(next);
    if (activeSetlistIdRef.current === id) {
      const fallbackId = next[0]?.id || 'all';
      setActiveSetlistId(fallbackId);
      saveActiveIds(activeTrackIdRef.current, fallbackId);
    }
  }, []);

  const handleToggleTrackInSetlist = useCallback((setlistId: string, trackId: string) => {
    setSetlists((prev) =>
      prev.map((sl) => {
        if (sl.id !== setlistId) return sl;
        const exists = sl.trackIds.includes(trackId);
        const nextIds = exists
          ? sl.trackIds.filter((x) => x !== trackId)
          : [...sl.trackIds, trackId];
        return {
          ...sl,
          trackIds: !exists && !sl.isCustomOrder ? sortTrackIdsByTitle(nextIds, tracksRef.current) : nextIds,
        };
      })
    );
  }, []);

  const handleMoveTrackInSetlist = useCallback((setlistId: string, trackId: string, dir: -1 | 1) => {
    const isNewEditSession = !sessionEditedSetlistsRef.current.has(setlistId);
    if (isNewEditSession) {
      sessionEditedSetlistsRef.current.add(setlistId);
    }
    const next = setlistsRef.current.map((sl) => {
      if (sl.id !== setlistId) return sl;
      const idx = sl.trackIds.indexOf(trackId);
      if (idx === -1) return sl;
      const target = idx + dir;
      if (target < 0 || target >= sl.trackIds.length) return sl;
      const copy = [...sl.trackIds];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return {
        ...sl,
        trackIds: copy,
        previousTrackIds: isNewEditSession ? sl.trackIds : sl.previousTrackIds,
        isCustomOrder: true,
      };
    });
    setSetlists(next);
    saveSetlists(next);
  }, []);

  const handleSortSetlistAlphabetical = useCallback((setlistId: string) => {
    sessionEditedSetlistsRef.current.delete(setlistId);
    if (setlistId === 'all') {
      allTracksCustomOrderRef.current = false;
      const current = tracksRef.current;
      const currentIds = current.map((tr) => tr.id);
      const sorted = [...current].sort(compareTrackTitles);
      const sortedIds = sorted.map((tr) => tr.id);
      if (!arraysEqual(currentIds, sortedIds)) {
        setPreviousAllTrackIds(currentIds);
      }
      setTracks(sorted);
      saveTracks(sorted);
      return;
    }

    const next = setlistsRef.current.map((sl) => {
      if (sl.id !== setlistId) return sl;
      const sortedIds = sortTrackIdsByTitle(sl.trackIds, tracksRef.current);
      const changed = !arraysEqual(sortedIds, sl.trackIds);
      return {
        ...sl,
        trackIds: sortedIds,
        previousTrackIds: changed ? sl.trackIds : sl.previousTrackIds,
        isCustomOrder: false,
      };
    });
    setSetlists(next);
    saveSetlists(next);
  }, []);

  const handleResetSetlistOrder = useCallback(
    (setlistId: string) => {
      sessionEditedSetlistsRef.current.delete(setlistId);
      if (setlistId === 'all') {
        if (!previousAllTrackIds || previousAllTrackIds.length === 0) return;
        const snapshot = previousAllTrackIds;
        const current = tracksRef.current;
        const map = new Map(current.map((tr) => [tr.id, tr]));
        const restored = snapshot
          .map((id) => map.get(id))
          .filter((tr): tr is PracticeTrack => Boolean(tr));
        const remaining = current
          .filter((tr) => !snapshot.includes(tr.id))
          .sort(compareTrackTitles);
        const next = [...restored, ...remaining];
        allTracksCustomOrderRef.current = !areTracksAlphabetical(next);
        setTracks(next);
        saveTracks(next);
        setPreviousAllTrackIds(null);
        return;
      }

      const next = setlistsRef.current.map((sl) => {
        if (sl.id !== setlistId || !sl.previousTrackIds || sl.previousTrackIds.length === 0) {
          return sl;
        }
        const currentSet = new Set(sl.trackIds);
        const kept = sl.previousTrackIds.filter((id) => currentSet.has(id));
        const keptSet = new Set(kept);
        const newlyAdded = sortTrackIdsByTitle(
          sl.trackIds.filter((id) => !keptSet.has(id)),
          tracksRef.current
        );
        const restoredIds = [...kept, ...newlyAdded];
        const alphaIds = sortTrackIdsByTitle(restoredIds, tracksRef.current);
        return {
          ...sl,
          trackIds: restoredIds,
          previousTrackIds: undefined,
          isCustomOrder: !arraysEqual(restoredIds, alphaIds),
        };
      });
      setSetlists(next);
      saveSetlists(next);
    },
    [previousAllTrackIds]
  );

  const handleDeleteTrack = async (trackId: string) => {
    inflightBlobRef.current.delete(trackId);
    blobCacheRef.current.delete(trackId);
    audio.evictTrackCache(trackId);
    try {
      await deleteAudioBlobFromDB(trackId);
    } catch (err) {
      console.warn('Could not delete audio blob from DB:', trackId, err);
    }

    const nextTracks = tracksRef.current.filter((tr) => tr.id !== trackId);
    setTracks(nextTracks);
    saveTracks(nextTracks);
    setPreviousAllTrackIds((prev) => (prev ? prev.filter((id) => id !== trackId) : null));

    const nextSetlists = setlistsRef.current.map((sl) => ({
      ...sl,
      trackIds: sl.trackIds.filter((id) => id !== trackId),
      previousTrackIds: sl.previousTrackIds?.filter((id) => id !== trackId),
    }));
    setSetlists(nextSetlists);
    saveSetlists(nextSetlists);

    if (activeTrackIdRef.current === trackId) {
      lastPrevClickRef.current = 0;
      const activeInPlaylist = activeSetlistTracksRef.current.find((tr) => tr.id !== trackId)?.id;
      const nextId = activeInPlaylist || nextTracks[0]?.id || '';
      setActiveTrackId(nextId);
      saveActiveIds(nextId, activeSetlistIdRef.current);
    }
  };

  const handleReorderActivePlaylist = useCallback((orderedIds: string[]) => {
    const currentSetlistId = activeSetlistIdRef.current;
    const currentSetlists = setlistsRef.current;
    if (currentSetlistId !== 'all' && currentSetlists.some((s) => s.id === currentSetlistId)) {
      const isNewEditSession = !sessionEditedSetlistsRef.current.has(currentSetlistId);
      if (isNewEditSession) {
        sessionEditedSetlistsRef.current.add(currentSetlistId);
      }
      const next = currentSetlists.map((sl) =>
        sl.id === currentSetlistId
          ? {
              ...sl,
              trackIds: orderedIds,
              previousTrackIds: isNewEditSession ? sl.trackIds : sl.previousTrackIds,
              isCustomOrder: true,
            }
          : sl
      );
      setSetlists(next);
      saveSetlists(next);
    } else {
      allTracksCustomOrderRef.current = true;
      const currentTracks = tracksRef.current;
      const isNewEditSession = !sessionEditedSetlistsRef.current.has('all');
      if (isNewEditSession) {
        sessionEditedSetlistsRef.current.add('all');
        setPreviousAllTrackIds(currentTracks.map((tr) => tr.id));
      }
      const map = new Map(currentTracks.map((tr) => [tr.id, tr]));
      const reordered = orderedIds
        .map((id) => map.get(id))
        .filter((tr): tr is PracticeTrack => Boolean(tr));
      const remaining = currentTracks.filter((tr) => !orderedIds.includes(tr.id));
      const next = [...reordered, ...remaining];
      setTracks(next);
      saveTracks(next);
    }
  }, []);

  const audioActionsRef = useRef({
    isPlaying: false,
    currentTime: 0,
    play: audio.play,
    pause: audio.pause,
    seekTo: audio.seekTo,
    unlockAudio: audio.unlockAudio,
    prewarmTrack: audio.prewarmTrack,
  });
  audioActionsRef.current = {
    isPlaying: audio.isPlaying,
    currentTime: audio.currentTime,
    play: audio.play,
    pause: audio.pause,
    seekTo: audio.seekTo,
    unlockAudio: audio.unlockAudio,
    prewarmTrack: audio.prewarmTrack,
  };

  // Global keyboard shortcuts (registered once, reads latest refs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }

      if (!activeTrackIdRef.current) return;
      const act = audioActionsRef.current;
      if (e.code === 'Space') {
        if (target?.closest('button, a, summary, [role="button"]')) return;
        e.preventDefault();
        if (act.isPlaying) act.pause();
        else act.play(0);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        act.seekTo(act.currentTime - 5);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        act.seekTo(act.currentTime + 5);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const preset = activeTrack?.preset ?? FALLBACK_PRESET;
  const volL = preset.volumeL ?? 1;
  const volR = preset.volumeR ?? 1;
  const pitchSt = preset.pitchSemitones;
  const pitchTones = pitchSt / 2;
  const pitchLabel =
    pitchTones === 0
      ? '0'
      : `${pitchTones > 0 ? '+' : ''}${Number.isInteger(pitchTones) ? pitchTones : pitchTones.toFixed(1)}`;
  const baseBpm = Math.max(40, Math.round(preset.bpm || 100));
  const speedPct = Math.round(preset.speed * 100);
  const minBpmSlider = 50;
  const maxBpmSlider = 150;

  const setTargetSpeedPct = (targetPct: number) => {
    const clampedTarget = Math.max(50, Math.min(200, targetPct));
    const nextSpeed = Number((clampedTarget / 100).toFixed(4));
    updatePreset({ speed: nextSpeed });
  };

  const toggleMuteL = () => {
    if (volL > 0.01) {
      prevVolLRef.current = volL;
      updatePreset({ volumeL: 0 });
    } else {
      updatePreset({ volumeL: prevVolLRef.current > 0.05 ? prevVolLRef.current : 1 });
    }
  };

  const toggleMuteR = () => {
    if (volR > 0.01) {
      prevVolRRef.current = volR;
      updatePreset({ volumeR: 0 });
    } else {
      updatePreset({ volumeR: prevVolRRef.current > 0.05 ? prevVolRRef.current : 1 });
    }
  };

  const clearReadyExport = useCallback(() => {
    if (exportCleanupTimerRef.current !== null) {
      window.clearTimeout(exportCleanupTimerRef.current);
      exportCleanupTimerRef.current = null;
    }
    setReadyExport((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const scheduleReadyExportCleanup = useCallback(
    (delayMs: number) => {
      if (exportCleanupTimerRef.current !== null) {
        window.clearTimeout(exportCleanupTimerRef.current);
      }
      exportCleanupTimerRef.current = window.setTimeout(() => {
        exportCleanupTimerRef.current = null;
        clearReadyExport();
      }, delayMs);
    },
    [clearReadyExport]
  );

  const handleExportAudio = useCallback(async () => {
    if (!activeTrack || !audio.audioBuffer || isExporting) return;
    if (exportCleanupTimerRef.current !== null) {
      window.clearTimeout(exportCleanupTimerRef.current);
      exportCleanupTimerRef.current = null;
    }
    setIsExporting(true);
    setExportProgress(0);
    try {
      const { speed, pitchSemitones, pitchCents, volumeL, volumeR } = activeTrack.preset;
      const wavBlob = await exportTrackAudioToWav({
        source: audio.audioBuffer,
        speed,
        totalSemitones: pitchSemitones + pitchCents / 100,
        volumeL: volumeL ?? 1,
        volumeR: volumeR ?? 1,
        swapLR: Boolean(settings.swapLR),
        onProgress: (p) => setExportProgress(Math.round(p * 100)),
      });

      const safeTitle =
        activeTrack.title
          .replace(/[/\\?%*:|"<>]/g, '')
          .replace(/\s+/g, ' ')
          .trim() || 'musica';
      const fileName = `${safeTitle} - Ajustada.wav`;
      const url = URL.createObjectURL(wavBlob);

      setReadyExport((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { blob: wavBlob, fileName, url };
      });
    } catch (err) {
      console.error('Failed to export audio:', err);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [activeTrack, audio.audioBuffer, isExporting, settings.swapLR]);

  const triggerDirectDownload = useCallback((exp: { url: string; fileName: string }) => {
    const a = document.createElement('a');
    a.href = exp.url;
    a.download = exp.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const canShareExportFile = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      return false;
    }
    if (typeof navigator.canShare !== 'function') {
      return isMobileClient;
    }
    try {
      const sampleFile = new File([], 'test.wav', { type: 'audio/wav' });
      return navigator.canShare({ files: [sampleFile] });
    } catch {
      return false;
    }
  }, [isMobileClient]);

  const handleChooseSaveLocation = useCallback(async () => {
    if (!readyExport) return;
    const { blob, fileName } = readyExport;

    // Native Save As folder picker on Desktop (remembers export folder & starts in Documents)
    const savePicker = (window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<{
        createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
      }>;
    }).showSaveFilePicker;

    if (typeof savePicker === 'function') {
      try {
        const handle = await savePicker({
          id: 'rivera-export-wav',
          startIn: 'documents',
          suggestedName: fileName,
          types: [{ description: 'WAV Audio', accept: { 'audio/wav': ['.wav'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        clearReadyExport();
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
      }
    }

    // Fallback to standard browser download (longer cleanup delay for iOS/iPadOS Safari download prompt)
    triggerDirectDownload(readyExport);
    scheduleReadyExportCleanup(5000);
  }, [clearReadyExport, readyExport, scheduleReadyExportCleanup, triggerDirectDownload]);

  const handleShareExport = useCallback(async () => {
    if (!readyExport) return;
    const { blob, fileName } = readyExport;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        const file = new File([blob], fileName, { type: 'audio/wav' });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: fileName,
          });
          clearReadyExport();
          return;
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
      }
    }

    // Fallback if Share API isn't supported in the current browser context
    await handleChooseSaveLocation();
  }, [clearReadyExport, handleChooseSaveLocation, readyExport]);

  const handleSelectSetlistInStudio = useCallback(
    (nextId: string) => {
      audioActionsRef.current.unlockAudio();
      const changedSetlist = nextId !== activeSetlistIdRef.current;
      setActiveSetlistId(nextId);

      if (isAndroidClient) {
        // On Android, opening a playlist ("Todas as Músicas" or folder) lets user pick a song immediately
        // without wasting CPU decoding Track #0 prematurely
        if (changedSetlist) {
          if (!activeTrackIdRef.current) {
            let firstValid: string | undefined;
            if (nextId === 'all') {
              firstValid = tracksRef.current[0]?.id;
            } else {
              const sl = setlistsRef.current.find((s) => s.id === nextId);
              firstValid = sl?.trackIds.find((id) => tracksRef.current.some((tr) => tr.id === id));
            }
            if (firstValid) {
              setActiveTrackId(firstValid);
              saveActiveIds(firstValid, nextId);
            } else {
              saveActiveIds(activeTrackIdRef.current, nextId);
            }
          } else {
            saveActiveIds(activeTrackIdRef.current, nextId);
          }
        }
        navigateToTab('playlistTracks');
        return;
      }

      if (changedSetlist) {
        let firstValid: string | undefined;
        if (nextId === 'all') {
          firstValid = tracksRef.current[0]?.id;
        } else {
          const sl = setlistsRef.current.find((s) => s.id === nextId);
          firstValid = sl?.trackIds.find((id) => tracksRef.current.some((tr) => tr.id === id));
        }
        if (firstValid) {
          setActiveTrackId(firstValid);
          saveActiveIds(firstValid, nextId);
        } else {
          saveActiveIds(activeTrackIdRef.current, nextId);
        }
      }
    },
    [isAndroidClient, navigateToTab]
  );

  const handleOpenPlaylistTracksView = useCallback(() => {
    audioActionsRef.current.unlockAudio();
    navigateToTab('playlistTracks');
  }, [navigateToTab]);

  const handleBackToStudio = useCallback(() => {
    navigateToTab('studio');
  }, [navigateToTab]);

  const handleSelectTrackInDropdown = useCallback(
    (id: string) => {
      const act = audioActionsRef.current;
      act.unlockAudio();
      if (id === activeTrackIdRef.current) {
        act.play(0, 0);
      } else {
        act.prewarmTrack(id);
        autoPlayOnLoadRef.current = true;
        setActiveTrackId(id);
      }
      if (activeTabRef.current !== 'studio') {
        navigateToTab('studio');
      }
    },
    [navigateToTab]
  );

  // Android PlaylistTracksView: auto-play clicked song while keeping the playlist screen open until user explicitly returns Home
  const handleSelectTrackInPlaylistView = useCallback((id: string) => {
    const act = audioActionsRef.current;
    act.unlockAudio();
    if (id === activeTrackIdRef.current) {
      act.play(0, 0);
    } else {
      act.prewarmTrack(id);
      autoPlayOnLoadRef.current = true;
      setActiveTrackId(id);
    }
  }, []);

  const handleSeek = useCallback((time: number) => {
    audioActionsRef.current.seekTo(time);
  }, []);

  const handleNoop = useCallback(() => {}, []);
  const handleSettingsUpdate = useCallback((patch: Partial<StudioSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  const handleSettingsReset = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const handleSortActivePlaylistAlphabetical = useCallback(() => {
    handleSortSetlistAlphabetical(activeSetlistIdRef.current);
  }, [handleSortSetlistAlphabetical]);

  const handleResetActivePlaylistOrder = useCallback(() => {
    handleResetSetlistOrder(activeSetlistIdRef.current);
  }, [handleResetSetlistOrder]);

  const handleRequestDeleteTrack = useCallback((track: PracticeTrack) => {
    setPendingDeleteTrack(track);
  }, []);

  const handleOpenUploadModal = useCallback(() => setShowUploadModal(true), []);
  const handleCloseUploadModal = useCallback(() => setShowUploadModal(false), []);
  const handleOpenTrackPicker = useCallback(
    () => uploadModalRef.current?.openAddMusicPicker({ isNewPlaylist: false }),
    []
  );

  const handleSetlistSelectTrack = useCallback((id: string) => {
    const act = audioActionsRef.current;
    act.unlockAudio();
    if (id === activeTrackIdRef.current) {
      act.play(0, 0);
    } else {
      act.prewarmTrack(id);
      autoPlayOnLoadRef.current = true;
      setActiveTrackId(id);
    }
  }, []);

  const handleSetlistOpenUploadModal = useCallback((isNewPlaylist?: boolean) => {
    uploadModalRef.current?.openAddMusicPicker({ isNewPlaylist });
  }, []);

  const isActivePlaylistAlphabetical = useMemo(
    () => areTracksAlphabetical(activeSetlistTracks),
    [activeSetlistTracks]
  );

  const canResetActiveOrder = useMemo(() => {
    if (activeSetlistId === 'all') {
      return Boolean(
        previousAllTrackIds &&
          previousAllTrackIds.length > 0 &&
          !arraysEqual(
            previousAllTrackIds,
            tracks.map((tr) => tr.id)
          )
      );
    }
    const activeSl = setlists.find((s) => s.id === activeSetlistId);
    return Boolean(
      activeSl?.previousTrackIds &&
        activeSl.previousTrackIds.length > 0 &&
        !arraysEqual(activeSl.previousTrackIds, activeSl.trackIds)
    );
  }, [activeSetlistId, previousAllTrackIds, setlists, tracks]);

  const existingTitlesCacheRef = useRef<string[]>([]);
  const existingTitles = useMemo(() => {
    const prev = existingTitlesCacheRef.current;
    if (prev.length === tracks.length) {
      let same = true;
      for (let i = 0; i < tracks.length; i++) {
        if (prev[i] !== tracks[i].title) {
          same = false;
          break;
        }
      }
      if (same) return prev;
    }
    const next = tracks.map((tr) => tr.title);
    existingTitlesCacheRef.current = next;
    return next;
  }, [tracks]);

  const handleTouchStartMain = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (e.touches.length !== 1 || pendingDeleteTrack || readyExport || showUploadModal) {
        swipeStartRef.current = null;
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [data-no-tab-swipe="true"]')) {
        swipeStartRef.current = null;
        return;
      }
      const touch = e.touches[0];
      swipeStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    },
    [pendingDeleteTrack, readyExport, showUploadModal]
  );

  const handleTouchEndMain = useCallback((e: React.TouchEvent<HTMLElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || e.changedTouches.length !== 1) return;

    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-no-tab-swipe="true"]')) return;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const dt = Date.now() - start.time;

    if (dt < 650 && Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      const curr = activeTabRef.current;
      if (curr === 'playlistTracks') return;
      const idx = TAB_ORDER.indexOf(curr);
      if (dx < 0 && idx >= 0 && idx < TAB_ORDER.length - 1) {
        navigateToTab(TAB_ORDER[idx + 1]);
      } else if (dx > 0 && idx > 0) {
        navigateToTab(TAB_ORDER[idx - 1]);
      }
    }
  }, [navigateToTab]);

  const activeSetlistName = useMemo(() => {
    if (activeSetlistId === 'all') return t.setlists.allTracks;
    return setlists.find((sl) => sl.id === activeSetlistId)?.name || t.setlists.allTracks;
  }, [activeSetlistId, setlists, t.setlists.allTracks]);

  const stageBtnH = 'min-h-[42px]';
  const stageTransportH = 'min-h-[54px]';

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-[var(--surface-base)] text-slate-900 dark:text-zinc-100">
      {/* Compact Top Header (Desktop & Mobile Portrait: centered stack; Mobile Landscape: 1-row bar) */}
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
              navigateToTab('studio');
            }}
            className={`flex items-center justify-center whitespace-nowrap shrink-0 ${
              isMobileLandscape ? 'flex-row gap-2' : 'flex-col gap-0.5'
            }`}
          >
            {settings.headerLogoDataUrl &&
              settings.headerLogoDataUrl !== 'none' &&
              (settings.headerBrandMode === 'logo' || settings.headerBrandMode === 'both') && (
                <img
                  src={settings.headerLogoDataUrl}
                  alt={t.appName}
                  width={48}
                  height={48}
                  decoding="async"
                  className={
                    isMobileLandscape
                      ? 'w-8 h-8 rounded-lg object-cover bg-black border border-amber-500/35 shadow-sm'
                      : settings.headerBrandMode === 'logo'
                        ? 'w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover bg-black border border-amber-500/35 shadow-sm'
                        : 'w-11 h-11 sm:w-12 sm:h-12 rounded-xl object-cover bg-black border border-amber-500/35 shadow-sm'
                  }
                />
              )}
            {(!settings.headerLogoDataUrl ||
              settings.headerLogoDataUrl === 'none' ||
              settings.headerBrandMode !== 'logo') && (
              <span
                className={
                  settings.headerLogoDataUrl &&
                  settings.headerLogoDataUrl !== 'none' &&
                  settings.headerBrandMode === 'both'
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
            {TAB_ORDER.map((tabKey) => {
              const active =
                activeTab === tabKey || (tabKey === 'studio' && activeTab === 'playlistTracks');
              return (
                <button
                  key={tabKey}
                  onClick={() => navigateToTab(tabKey)}
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
          </nav>
        </div>
      </header>

      <main
        onTouchStart={handleTouchStartMain}
        onTouchEnd={handleTouchEndMain}
        onTouchCancel={() => {
          swipeStartRef.current = null;
        }}
        className={`flex-1 w-full mx-auto pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] touch-pan-y ${
          activeTab === 'studio'
            ? isMobileLandscape && activeTrack
              ? 'max-w-5xl py-2 pb-4'
              : activeTrack
                ? 'max-w-xl md:max-w-2xl lg:max-w-5xl py-2.5 lg:py-4 pb-20 sm:pb-6 sm:px-6'
                : 'max-w-xl md:max-w-2xl py-2.5 pb-20 sm:pb-6'
            : activeTab === 'setlists' || activeTab === 'playlistTracks'
              ? isMobileLandscape
                ? 'max-w-3xl py-3 pb-8'
                : 'max-w-xl md:max-w-2xl lg:max-w-3xl py-3 pb-8'
              : 'max-w-5xl py-3 pb-8 sm:px-6'
        }`}
      >
        {activeTab === 'studio' && (
          <div
            className={
              isMobileLandscape && activeTrack
                ? 'grid grid-cols-2 gap-3 items-start'
                : activeTrack
                  ? 'flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start'
                  : 'flex flex-col gap-2'
            }
          >
            {/* Left Column (Portrait top-half; Landscape left cockpit) */}
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleOpenTrackPicker}
                    disabled={isImporting}
                    className="min-h-[40px] px-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-70 text-[var(--accent-fg)] text-xs sm:text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer active:scale-[0.98] transition-transform"
                  >
                    {isImporting ? (
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 shrink-0" />
                    )}
                    <span>
                      {isImporting
                        ? importStatus
                          ? `${t.uploadModal.uploadingShort} (${importStatus.current}/${importStatus.total})`
                          : t.uploadModal.uploadingShort
                        : t.importAudio}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportAudio}
                    disabled={!activeTrack || !audio.audioBuffer || audio.isLoadingAudio || isExporting}
                    className="min-h-[40px] px-3 rounded-xl bg-[var(--surface-card)] hover:bg-[var(--surface-control)] border border-[var(--surface-border-subtle)] hover:border-amber-500/60 disabled:opacity-40 text-slate-900 dark:text-zinc-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer active:scale-[0.98] transition-all shadow-sm dark:shadow-none"
                  >
                    <Download className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>
                      {isExporting
                        ? `${t.exporting}${exportProgress > 0 ? ` ${exportProgress}%` : ''}`
                        : t.exportAudio}
                    </span>
                  </button>
                </div>
                <PWAInstallButton t={t} compact />
              </div>

              <section className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-2.5 shadow-sm dark:shadow-none">
                <PlaylistSelectorDropdown
                  setlists={setlists}
                  tracks={tracks}
                  activeSetlistId={activeSetlistId}
                  t={t}
                  onSelectSetlist={handleSelectSetlistInStudio}
                />
              </section>

              {!activeTrack && (
                <section className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-5 text-center flex flex-col items-center gap-3 shadow-sm dark:shadow-none">
                  <p className="text-sm text-slate-600 dark:text-zinc-300">{t.live.noTracksEmpty}</p>
                </section>
              )}

              {activeTrack && (
                <>
            {/* 1. Track Selector & Setlist Prev/Next */}
            <section className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-2.5 flex flex-col gap-2 shadow-sm dark:shadow-none">
              <div className="flex items-center justify-between gap-2">
                <button
                  onPointerDown={() => {
                    if (activeSetlistTracks.length <= 1) return;
                    const baseIdx = currentTrackIndex >= 0 ? currentTrackIndex : 0;
                    const prevIdx =
                      (baseIdx - 1 + activeSetlistTracks.length) % activeSetlistTracks.length;
                    audio.prewarmTrack(activeSetlistTracks[prevIdx].id);
                  }}
                  onClick={() => {
                    if (activeSetlistTracks.length === 0) return;
                    audio.unlockAudio();
                    const now = Date.now();
                    const isSecondClick = now - lastPrevClickRef.current < 2000;

                    if (!isSecondClick || activeSetlistTracks.length === 1) {
                      lastPrevClickRef.current = now;
                      audio.play(0, 0);
                      return;
                    }

                    lastPrevClickRef.current = 0;
                    const baseIdx = currentTrackIndex >= 0 ? currentTrackIndex : 0;
                    const prevIdx =
                      (baseIdx - 1 + activeSetlistTracks.length) % activeSetlistTracks.length;
                    autoPlayOnLoadRef.current = true;
                    setActiveTrackId(activeSetlistTracks[prevIdx].id);
                  }}
                  disabled={activeSetlistTracks.length === 0}
                  className={`${stageBtnH} px-3 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center gap-1 text-xs font-medium text-slate-800 dark:text-zinc-200 hover:border-slate-400 dark:hover:border-zinc-500 disabled:opacity-30 shrink-0 cursor-pointer`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>{t.live.prevTrack}</span>
                </button>

                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-zinc-400">
                  {currentTrackIndex >= 0 ? `${currentTrackIndex + 1} / ${activeSetlistTracks.length}` : ''}
                </span>

                <button
                  onPointerDown={() => {
                    if (activeSetlistTracks.length <= 1) return;
                    const baseIdx = currentTrackIndex >= 0 ? currentTrackIndex : 0;
                    const nextIdx = (baseIdx + 1) % activeSetlistTracks.length;
                    audio.prewarmTrack(activeSetlistTracks[nextIdx].id);
                  }}
                  onClick={() => {
                    if (activeSetlistTracks.length === 0) return;
                    lastPrevClickRef.current = 0;
                    audio.unlockAudio();
                    if (activeSetlistTracks.length === 1) {
                      audio.play(0, 0);
                      return;
                    }
                    const baseIdx = currentTrackIndex >= 0 ? currentTrackIndex : 0;
                    const nextIdx = (baseIdx + 1) % activeSetlistTracks.length;
                    autoPlayOnLoadRef.current = true;
                    setActiveTrackId(activeSetlistTracks[nextIdx].id);
                  }}
                  disabled={activeSetlistTracks.length === 0}
                  className={`${stageBtnH} px-3 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center gap-1 text-xs font-medium text-slate-800 dark:text-zinc-200 hover:border-slate-400 dark:hover:border-zinc-500 disabled:opacity-30 shrink-0 cursor-pointer`}
                >
                  <span>{t.live.nextTrack}</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <PlaylistTrackDropdown
                tracks={activeSetlistTracks}
                activeTrackId={
                  activeSetlistTracks.some((tr) => tr.id === activeTrack.id)
                    ? activeTrack.id
                    : activeSetlistTracks[0]?.id || ''
                }
                isAlphabetical={isActivePlaylistAlphabetical}
                canResetOrder={canResetActiveOrder}
                t={t}
                onSelectTrack={handleSelectTrackInDropdown}
                onReorderTracks={handleReorderActivePlaylist}
                onSortAlphabetical={handleSortActivePlaylistAlphabetical}
                onResetOrder={handleResetActivePlaylistOrder}
                onRequestDeleteTrack={handleRequestDeleteTrack}
                onOpenFullView={isAndroidClient ? handleOpenPlaylistTracksView : undefined}
                onUnlockAudio={audio.unlockAudio}
                onPrewarmTrack={audio.prewarmTrack}
                onPrefetchTracks={audio.prefetchTracks}
              />
            </section>

            {/* 2. Clean Waveform + Timecode + Compact Manual/Auto Switch */}
            <section className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-2.5 flex flex-col gap-2 shadow-sm dark:shadow-none">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-zinc-100 whitespace-nowrap">
                  {formatTimecode(audio.currentTime)}
                  <span className="text-slate-400 dark:text-zinc-500 text-xs font-normal">
                    {' / '}
                    {formatTimecode(audio.duration || activeTrack.duration)}
                  </span>
                </div>

                <div className="inline-flex items-center p-0.5 bg-[var(--surface-base)] rounded-lg border border-[var(--surface-border-subtle)] shrink-0">
                  <button
                    onClick={() => handleSettingsUpdate({ autoAdvance: false })}
                    title={t.live.manualMode}
                    className={`min-h-[34px] px-2.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      !settings.autoAdvance
                        ? 'bg-white dark:bg-[var(--surface-control)] text-amber-700 dark:text-amber-400 shadow-sm dark:shadow-none'
                        : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {t.live.manualShort}
                  </button>
                  <button
                    onClick={() => handleSettingsUpdate({ autoAdvance: true })}
                    title={t.live.autoMode}
                    className={`min-h-[34px] px-2.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      settings.autoAdvance
                        ? 'bg-white dark:bg-[var(--surface-control)] text-amber-700 dark:text-amber-400 shadow-sm dark:shadow-none'
                        : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {t.live.autoShort}
                  </button>
                </div>
              </div>

              <WaveformCanvas
                peaks={audio.peaks}
                duration={audio.duration || activeTrack.duration}
                currentTime={audio.currentTime}
                loopA={null}
                loopB={null}
                loopEnabled={false}
                bpm={activeTrack.preset.bpm}
                beatsPerBar={activeTrack.preset.beatsPerBar}
                beatOffset={activeTrack.preset.beatOffset}
                sections={EMPTY_SECTIONS}
                zoom={1}
                followPlayhead={false}
                snapMode="off"
                showBeatGrid={false}
                compactLandscape={isMobileLandscape}
                theme={activeTheme}
                palette={activePalette}
                onSeek={handleSeek}
                onLoopAChange={handleNoop}
                onLoopBChange={handleNoop}
                onSelectSection={handleNoop}
                onLoopSection={handleNoop}
                onZoomChange={handleNoop}
              />
            </section>

              {/* 4. Thumb-Zone Transport Bar (Fixed bottom in portrait mobile; inline in landscape/desktop) */}
              <div
                className={
                  isMobileLandscape
                    ? 'static p-0 bg-transparent border-0'
                    : 'fixed bottom-0 left-0 right-0 z-30 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-[var(--surface-base-translucent)] backdrop-blur-md border-t border-[var(--surface-border-subtle)] sm:static sm:p-0 sm:bg-transparent sm:backdrop-blur-none sm:border-0'
                }
              >
                <div className="max-w-xl mx-auto grid grid-cols-3 gap-2">
                  <button
                    onClick={audio.stop}
                    className={`${stageTransportH} rounded-xl bg-[var(--surface-card)] dark:bg-[var(--surface-control)] border border-[var(--surface-border)] text-slate-800 dark:text-zinc-200 hover:border-slate-400 dark:hover:border-zinc-500 font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition-transform shadow-sm dark:shadow-none`}
                  >
                    {audio.currentTime > 0 && !audio.isPlaying ? (
                      <RotateCcw className="w-4 h-4" />
                    ) : (
                      <Square className="w-4 h-4 fill-current" />
                    )}
                    <span>{t.transport.stop}</span>
                  </button>

                  <button
                    onClick={() => {
                      if (audio.isPlaying) audio.pause();
                      else audio.play(0);
                    }}
                    disabled={audio.isLoadingAudio}
                    className={`col-span-2 ${stageTransportH} rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] font-bold text-base flex items-center justify-center gap-2.5 cursor-pointer active:scale-[0.98] transition-transform shadow-sm dark:shadow-none`}
                  >
                    {audio.isPlaying ? (
                      <>
                        <Pause className="w-5 h-5 fill-current" />
                        <span>{t.transport.pause}</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-5 h-5 fill-current" />
                        <span>{t.transport.play}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
            </div>

            {/* Right Column (Portrait below; Landscape right cockpit: Pitch + BPM + L/R Volumes) */}
            {activeTrack && (
              <div className="flex flex-col gap-2 min-w-0">
                {/* 3. Essential Live Controls: Pitch + BPM + Volume L + Volume R */}
                <section className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-2.5 sm:p-3 flex flex-col gap-2.5 shadow-sm dark:shadow-none">
              <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[var(--surface-border-subtle)]">
                <span className="text-xs font-medium text-slate-500 dark:text-zinc-400">{t.live.controlsHeader}</span>
                <button
                  onClick={() => handleSettingsUpdate({ swapLR: !settings.swapLR })}
                  className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    settings.swapLR
                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-800 dark:text-amber-300'
                      : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-700 dark:text-zinc-300 hover:border-slate-400 dark:hover:border-zinc-500'
                  }`}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>{settings.swapLR ? t.live.swapLRActive : t.live.swapLR}</span>
                </button>
              </div>

              {/* Pitch Button, Individual Reset Arrow & Half-Tone Stepper */}
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
                  <button
                    onClick={() => setShowPitchPanel((v) => !v)}
                    className={`justify-self-start min-h-[40px] px-2.5 sm:px-3 rounded-lg border flex items-center gap-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      pitchSt !== 0 || showPitchPanel
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-800 dark:text-amber-300'
                        : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-900 dark:text-zinc-100'
                    }`}
                  >
                    <Sliders className="w-4 h-4 shrink-0" />
                    <span>{t.live.pitchTitle}</span>
                  </button>

                  <button
                    onClick={() => updatePreset({ pitchSemitones: 0, pitchCents: 0 })}
                    aria-label={t.live.resetPitch}
                    title={t.live.resetPitch}
                    className={`w-[38px] min-h-[40px] rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                      pitchSt !== 0
                        ? 'bg-amber-500/10 dark:bg-[var(--surface-control)] border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15'
                        : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() =>
                        updatePreset({ pitchSemitones: Math.max(-12, pitchSt - 1) })
                      }
                      aria-label="Pitch down half tone"
                      className="w-[38px] sm:w-[42px] min-h-[40px] rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-900 dark:text-zinc-100 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <div
                      className={`min-h-[40px] w-[46px] sm:w-[50px] px-1 rounded-lg bg-[var(--surface-base)] border flex items-center justify-center font-mono tabular-nums text-xs font-semibold ${
                        pitchSt !== 0
                          ? 'border-amber-500/50 text-amber-800 dark:text-amber-300'
                          : 'border-[var(--surface-border)] text-slate-800 dark:text-zinc-200'
                      }`}
                    >
                      {pitchLabel}
                    </div>
                    <button
                      onClick={() =>
                        updatePreset({ pitchSemitones: Math.min(12, pitchSt + 1) })
                      }
                      aria-label="Pitch up half tone"
                      className="w-[38px] sm:w-[42px] min-h-[40px] rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-900 dark:text-zinc-100 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {showPitchPanel && (
                  <div className="pt-0.5 pb-0.5">
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={1}
                      value={pitchSt}
                      onChange={(e) => updatePreset({ pitchSemitones: parseInt(e.target.value, 10) })}
                      className="studio-slider w-full"
                    />
                  </div>
                )}
              </div>

              {/* BPM Button, Individual Reset Arrow & Tempo Stepper */}
              <div className="pt-2.5 border-t border-[var(--surface-border-subtle)] flex flex-col gap-2">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
                  <button
                    onClick={() => setShowBpmPanel((v) => !v)}
                    className={`justify-self-start min-h-[40px] px-2.5 sm:px-3 rounded-lg border flex items-center gap-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      Math.abs(preset.speed - 1) > 0.005 || showBpmPanel
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-800 dark:text-amber-300'
                        : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-900 dark:text-zinc-100'
                    }`}
                  >
                    <Gauge className="w-4 h-4 shrink-0" />
                    <span>{t.live.bpmTitle}</span>
                    <span className="font-mono tabular-nums ml-0.5">{baseBpm}</span>
                  </button>

                  <button
                    onClick={() => updatePreset({ speed: 1 })}
                    aria-label={t.live.resetBpm}
                    title={t.live.resetBpm}
                    className={`w-[38px] min-h-[40px] rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                      Math.abs(preset.speed - 1) > 0.005
                        ? 'bg-amber-500/10 dark:bg-[var(--surface-control)] border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15'
                        : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setTargetSpeedPct(speedPct - 1)}
                      aria-label="BPM down"
                      className="w-[38px] sm:w-[42px] min-h-[40px] rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-900 dark:text-zinc-100 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <div
                      className={`min-h-[40px] w-[46px] sm:w-[50px] px-1 rounded-lg bg-[var(--surface-base)] border flex items-center justify-center font-mono tabular-nums text-xs font-semibold ${
                        Math.abs(preset.speed - 1) > 0.005
                          ? 'border-amber-500/50 text-amber-800 dark:text-amber-300'
                          : 'border-[var(--surface-border)] text-slate-800 dark:text-zinc-200'
                      }`}
                    >
                      {speedPct}
                    </div>
                    <button
                      onClick={() => setTargetSpeedPct(speedPct + 1)}
                      aria-label="BPM up"
                      className="w-[38px] sm:w-[42px] min-h-[40px] rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-900 dark:text-zinc-100 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {showBpmPanel && (
                  <div className="pt-0.5 pb-0.5 flex flex-col gap-2">
                    <input
                      type="range"
                      min={minBpmSlider}
                      max={maxBpmSlider}
                      step={1}
                      value={Math.max(minBpmSlider, Math.min(maxBpmSlider, speedPct))}
                      onChange={(e) => setTargetSpeedPct(parseInt(e.target.value, 10))}
                      className="studio-slider w-full"
                    />
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-zinc-400">
                      <span>{t.live.origBpm}:</span>
                      <input
                        type="number"
                        min={40}
                        max={240}
                        value={baseBpm}
                        onChange={(e) =>
                          updatePreset({
                            bpm: Math.max(40, Math.min(240, Number(e.target.value) || 100)),
                          })
                        }
                        className="w-20 h-8 px-2 rounded-lg bg-[var(--surface-base)] border border-[var(--surface-border)] font-mono tabular-nums text-xs text-slate-900 dark:text-zinc-100 text-center"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Independent Volume L and Volume R for P2 -> 2x P10 Mono Y-Cable */}
              <div className="pt-2.5 border-t border-[var(--surface-border-subtle)] grid grid-cols-1 gap-2.5">
                {/* Channel L */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-800 dark:text-amber-400 font-mono text-xs font-bold flex items-center justify-center">
                        L
                      </span>
                      <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-zinc-100">{t.live.volumeL}</span>
                      {settings.swapLR && (
                        <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400">→ R</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-slate-700 dark:text-zinc-200 w-10 text-right">
                        {Math.round(volL * 100)}%
                      </span>
                      <button
                        onClick={toggleMuteL}
                        className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 cursor-pointer ${
                          volL <= 0.01
                            ? 'bg-rose-500/15 dark:bg-rose-500/20 border-rose-500/50 text-rose-700 dark:text-rose-300'
                            : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-700 dark:text-zinc-300'
                        }`}
                      >
                        {volL <= 0.01 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                        <span>{volL <= 0.01 ? t.live.mute : 'On'}</span>
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={volL}
                    onChange={(e) => updatePreset({ volumeL: parseFloat(e.target.value) })}
                    className="studio-slider w-full"
                  />
                </div>

                {/* Channel R */}
                <div className="flex flex-col gap-1.5 pt-2 border-t border-[var(--surface-border-subtle)]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-800 dark:text-emerald-400 font-mono text-xs font-bold flex items-center justify-center">
                        R
                      </span>
                      <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-zinc-100">{t.live.volumeR}</span>
                      {settings.swapLR && (
                        <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400">→ L</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-slate-700 dark:text-zinc-200 w-10 text-right">
                        {Math.round(volR * 100)}%
                      </span>
                      <button
                        onClick={toggleMuteR}
                        className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 cursor-pointer ${
                          volR <= 0.01
                            ? 'bg-rose-500/15 dark:bg-rose-500/20 border-rose-500/50 text-rose-700 dark:text-rose-300'
                            : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-700 dark:text-zinc-300'
                        }`}
                      >
                        {volR <= 0.01 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                        <span>{volR <= 0.01 ? t.live.mute : 'On'}</span>
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={volR}
                    onChange={(e) => updatePreset({ volumeR: parseFloat(e.target.value) })}
                    className="studio-slider w-full"
                  />
                </div>
              </div>
                </section>
              </div>
            )}
          </div>
        )}

        {activeTab === 'playlistTracks' && (
          <PlaylistTracksView
            playlistName={activeSetlistName}
            tracks={activeSetlistTracks}
            activeTrackId={
              activeSetlistTracks.some((tr) => tr.id === activeTrack?.id)
                ? activeTrack?.id || ''
                : activeSetlistTracks[0]?.id || ''
            }
            isPlaying={audio.isPlaying}
            isImporting={isImporting}
            isAlphabetical={isActivePlaylistAlphabetical}
            canResetOrder={canResetActiveOrder}
            t={t}
            onBack={handleBackToStudio}
            onSelectTrack={handleSelectTrackInPlaylistView}
            onReorderTracks={handleReorderActivePlaylist}
            onSortAlphabetical={handleSortActivePlaylistAlphabetical}
            onResetOrder={handleResetActivePlaylistOrder}
            onRequestDeleteTrack={handleRequestDeleteTrack}
            onUploadTracks={handleOpenTrackPicker}
            onPrewarmTrack={audio.prewarmTrack}
            onPrefetchTracks={audio.prefetchTracks}
          />
        )}

        {activeTab === 'setlists' && (
          <SetlistsView
            t={t}
            tracks={tracks}
            setlists={setlists}
            activeTrackId={activeTrack?.id || ''}
            isPlaying={audio.isPlaying}
            isImporting={isImporting}
            onSelectTrack={handleSetlistSelectTrack}
            onSelectSetlist={setActiveSetlistId}
            onCreateSetlist={handleCreateSetlist}
            onDeleteSetlist={handleDeleteSetlist}
            onToggleTrackInSetlist={handleToggleTrackInSetlist}
            onMoveTrackInSetlist={handleMoveTrackInSetlist}
            onSortSetlistAlphabetical={handleSortSetlistAlphabetical}
            onResetSetlistOrder={handleResetSetlistOrder}
            onOpenUploadModal={handleSetlistOpenUploadModal}
            onPrewarmTrack={audio.prewarmTrack}
            onPrefetchTracks={audio.prefetchTracks}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            t={t}
            settings={settings}
            onUpdate={handleSettingsUpdate}
            onResetDefaults={handleSettingsReset}
          />
        )}
      </main>

      {/* Delete Track Confirmation Modal */}
      {pendingDeleteTrack && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPendingDeleteTrack(null)}
        >
          <div
            className="w-full max-w-sm bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-2xl p-5 flex flex-col gap-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-zinc-100">
                  {t.live.deleteTrackTitle}
                </h3>
                <p className="text-sm text-slate-600 dark:text-zinc-300 mt-1">
                  {t.live.deleteTrackConfirm}
                </p>
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 truncate mt-1.5">
                  {pendingDeleteTrack.title}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setPendingDeleteTrack(null)}
                className="min-h-[44px] px-4 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] text-sm font-semibold text-slate-800 dark:text-zinc-200 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
              >
                {t.live.cancel}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const idToDelete = pendingDeleteTrack.id;
                  setPendingDeleteTrack(null);
                  await handleDeleteTrack(idToDelete);
                }}
                className="min-h-[44px] px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold cursor-pointer"
              >
                {t.live.confirmDelete}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Ready Save As Modal */}
      {readyExport && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={clearReadyExport}
        >
          <div
            className="w-full max-w-sm bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-2xl p-5 flex flex-col gap-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-zinc-100">
                  {t.saveModalTitle}
                </h3>
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 truncate mt-1">
                  {readyExport.fileName}
                </p>
              </div>
              <button
                type="button"
                onClick={clearReadyExport}
                aria-label={t.pwa.close}
                className="w-8 h-8 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              {isMobileClient ? (
                <>
                  {canShareExportFile && (
                    <button
                      type="button"
                      onClick={handleShareExport}
                      className="min-h-[46px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer text-center"
                    >
                      <Share2 className="w-4 h-4 shrink-0" />
                      <span>{t.saveShareApps}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleChooseSaveLocation}
                    className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer ${
                      canShareExportFile
                        ? 'bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-slate-400 dark:hover:border-zinc-500 text-slate-900 dark:text-zinc-100'
                        : 'bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] font-bold'
                    }`}
                  >
                    <Download className={`w-4 h-4 shrink-0 ${canShareExportFile ? 'text-amber-700 dark:text-amber-400' : ''}`} />
                    <span>{t.saveDirectDownload}</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleChooseSaveLocation}
                    className="min-h-[46px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <FolderOpen className="w-4 h-4 shrink-0" />
                    <span>{t.saveChooseFolder}</span>
                  </button>

                  {canShareExportFile && (
                    <button
                      type="button"
                      onClick={handleShareExport}
                      className="min-h-[44px] px-4 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-amber-500/60 text-slate-900 dark:text-zinc-100 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Share2 className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-400" />
                      <span>{t.saveShareApps}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      triggerDirectDownload(readyExport);
                      scheduleReadyExportCleanup(1500);
                    }}
                    className="min-h-[44px] px-4 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-slate-400 dark:hover:border-zinc-500 text-slate-900 dark:text-zinc-100 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-400" />
                    <span>{t.saveDirectDownload}</span>
                  </button>
                </>
              )}
            </div>

            <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">
              {t.saveChromeHint}
            </p>
          </div>
        </div>
      )}

      <UploadTracksModal
        ref={uploadModalRef}
        open={showUploadModal}
        t={t}
        existingTitles={existingTitles}
        isImporting={isImporting}
        onRequestOpen={handleOpenUploadModal}
        onClose={handleCloseUploadModal}
        onPreparingImport={handlePreparingImport}
        onImportEmpty={handleImportEmpty}
        onImportFiles={handleImportFiles}
      />

      {/* Floating Upload Progress Spinner, Completion & Warning Notice */}
      {(isImporting || importSuccessCount !== null || importErrorNotice !== null) && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-24px)] max-w-sm pointer-events-none">
          {isImporting ? (
            <div className="bg-[var(--surface-card-translucent)] backdrop-blur-md border border-amber-500/60 rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3">
              <Loader2 className="w-6 h-6 text-amber-600 dark:text-amber-400 animate-spin shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-zinc-100">
                    {t.uploadModal.uploadingTitle}
                  </span>
                  {importStatus && importStatus.total > 0 && (
                    <span className="text-[11px] font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400 shrink-0">
                      {importStatus.current} / {importStatus.total}
                    </span>
                  )}
                </div>
                {importStatus && (
                  <>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                      {importStatus.fileName}
                    </p>
                    {importStatus.total > 0 && (
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-[var(--surface-base)] overflow-hidden border border-[var(--surface-border)]">
                        <div
                          className="h-full bg-amber-500 transition-all duration-200"
                          style={{
                            width: `${Math.round((importStatus.current / Math.max(1, importStatus.total)) * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : importSuccessCount !== null ? (
            <div className="bg-[var(--surface-card-translucent)] backdrop-blur-md border border-emerald-500/60 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                {importSuccessCount} · {t.uploadModal.uploadSuccess}
              </span>
            </div>
          ) : (
            <div className="bg-[var(--surface-card-translucent)] backdrop-blur-md border border-rose-500/60 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
              <span className="text-xs font-medium text-rose-800 dark:text-rose-100 leading-snug">
                {importErrorNotice}
              </span>
            </div>
          )}
        </div>
      )}

      {showExitNotice && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[65] w-max max-w-[calc(100%-32px)] pointer-events-none">
          <div className="bg-slate-900/95 dark:bg-[var(--surface-control)]/95 text-white dark:text-zinc-100 border border-slate-700 dark:border-amber-500/40 rounded-xl px-4 py-2.5 shadow-2xl text-xs sm:text-sm font-medium text-center">
            {t.live.exitBackPrompt}
          </div>
        </div>
      )}

      <AndroidDirectInstallerSheet t={t} ready={bootSplashDone} />
      <OfflineIndicator t={t} />
    </div>
  );
}
