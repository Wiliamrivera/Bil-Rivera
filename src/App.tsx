import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Upload,
} from 'lucide-react';
import { formatTimecode } from './audio/audioUtils';
import { synthesizeDemoWavBlobAsync } from './audio/demoTracks';
import { AppHeader, AppTab, MAIN_TAB_ORDER } from './components/AppHeader';
import { LiveControlsPanel } from './components/LiveControlsPanel';
import { PlaylistSelectorDropdown } from './components/PlaylistSelectorDropdown';
import { PlaylistTrackDropdown } from './components/PlaylistTrackDropdown';
import { PlaylistTracksView } from './components/PlaylistTracksView';
import { PromoWebsiteView } from './components/PromoWebsiteView';
import {
  AndroidDirectInstallerSheet,
  OfflineIndicator,
  PWAInstallButton,
} from './components/PWAInstallButton';
import { SetlistsView } from './components/SetlistsView';
import { SettingsView } from './components/SettingsView';
import { StudioModals } from './components/StudioModals';
import { UploadTracksModal, UploadTracksModalHandle } from './components/UploadTracksModal';
import { WaveformCanvas } from './components/WaveformCanvas';
import { useAndroidBackGuard } from './hooks/useAndroidBackGuard';
import { useAudioExport } from './hooks/useAudioExport';
import { useBootSplash } from './hooks/useBootSplash';
import { useMobileLandscape } from './hooks/useMobileLandscape';
import { usePracticeAudio } from './hooks/usePracticeAudio';
import { useTrackImporter } from './hooks/useTrackImporter';
import { TRANSLATIONS } from './i18n/translations';
import { loadInitialStudioData } from './storage/studioMigration';
import {
  DEFAULT_SETTINGS,
  deleteAudioBlobFromDB,
  loadAudioBlobFromDB,
  saveActiveIds,
  saveSetlists,
  saveSettings,
  saveTracks,
} from './storage/studioStorage';
import { PracticeTrack, Setlist, StudioSettings, TrackPreset } from './types/studio';
import {
  isAndroidDevice,
  isHandheldOrTablet,
  isRunningInsideNativeShell,
} from './utils/platform';
import {
  areTracksAlphabetical,
  arraysEqual,
  compareTrackTitles,
  EMPTY_SECTIONS,
  FALLBACK_PRESET,
  PALETTE_META_THEME_COLORS,
  resolveFirstValidTrackId,
  resolveThemeAndPalette,
  sortTrackIdsByTitle,
} from './utils/trackUtils';

function hasPromoRouteFlag(): boolean {
  if (typeof window === 'undefined' || isRunningInsideNativeShell()) return false;
  try {
    return (
      new URLSearchParams(window.location.search).get('site') === '1' ||
      window.location.hash === '#site' ||
      window.location.pathname === '/site'
    );
  } catch {
    return false;
  }
}

function clearPromoRouteFlag(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    let changed = false;
    if (url.searchParams.has('site')) {
      url.searchParams.delete('site');
      changed = true;
    }
    if (url.hash === '#site') {
      url.hash = '';
      changed = true;
    }
    if (changed) {
      const next = `${url.pathname}${url.search}${url.hash}` || '/';
      window.history.replaceState(window.history.state, '', next);
    }
  } catch {
    // ignore history errors
  }
}

export default function App() {
  const initialData = useMemo(() => loadInitialStudioData(), []);
  const [tracks, setTracks] = useState<PracticeTrack[]>(initialData.baseTracks);
  const [setlists, setSetlists] = useState<Setlist[]>(initialData.migratedSetlists);
  const [settings, setSettings] = useState<StudioSettings>(initialData.savedSettings);
  const [activeTrackId, setActiveTrackId] = useState<string>(initialData.initialTrackId);
  const [activeSetlistId, setActiveSetlistId] = useState<string>(initialData.initialSetlistId);
  const [activeTab, setActiveTab] = useState<AppTab>(() =>
    hasPromoRouteFlag() ? 'promo' : 'studio'
  );
  const [previousAllTrackIds, setPreviousAllTrackIds] = useState<string[] | null>(null);
  const [pendingDeleteTrack, setPendingDeleteTrack] = useState<PracticeTrack | null>(null);
  const [pendingRenameTrack, setPendingRenameTrack] = useState<PracticeTrack | null>(null);
  const [renameTitleInput, setRenameTitleInput] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [exportSuccessNotice, setExportSuccessNotice] = useState<string | null>(null);
  const exportSuccessTimerRef = useRef<number | null>(null);

  const { activeTheme, activePalette } = resolveThemeAndPalette(settings);
  const t = TRANSLATIONS[settings.language];

  const isMobileClient = useMemo(() => isHandheldOrTablet(), []);
  const isAndroidClient = useMemo(() => isAndroidDevice(), []);
  const isNativeShell = useMemo(() => isRunningInsideNativeShell(), []);
  const bootSplashDone = useBootSplash();
  const isMobileLandscape = useMobileLandscape(isMobileClient);

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

  const uploadModalRef = useRef<UploadTracksModalHandle | null>(null);
  const activeTabRef = useRef<AppTab>(activeTab);
  activeTabRef.current = activeTab;
  const activeTrackIdRef = useRef(activeTrackId);
  activeTrackIdRef.current = activeTrackId;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const setlistsRef = useRef(setlists);
  setlistsRef.current = setlists;
  const activeSetlistIdRef = useRef(activeSetlistId);
  activeSetlistIdRef.current = activeSetlistId;
  const pendingRenameTrackRef = useRef<PracticeTrack | null>(pendingRenameTrack);
  pendingRenameTrackRef.current = pendingRenameTrack;
  const sessionEditedSetlistsRef = useRef<Set<string>>(new Set());
  const allTracksCustomOrderRef = useRef<boolean>(false);
  const demoBlobCacheRef = useRef<Map<string, Blob>>(new Map());
  const blobCacheRef = useRef<Map<string, Blob>>(new Map());
  const inflightBlobRef = useRef<Map<string, Promise<Blob | null>>>(new Map());
  const autoPlayOnLoadRef = useRef<boolean>(false);
  const lastPrevClickRef = useRef<number>(0);
  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

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

  // Debounced persistence + suspend/exit flush
  const lastSavedStateRef = useRef({
    tracks,
    setlists,
    settings,
    activeTrackId,
    activeSetlistId,
  });

  const latestStateRef = useRef({ tracks, setlists, settings, activeTrackId, activeSetlistId });
  latestStateRef.current = { tracks, setlists, settings, activeTrackId, activeSetlistId };

  const commitTracks = useCallback((next: PracticeTrack[]) => {
    setTracks(next);
    saveTracks(next);
    lastSavedStateRef.current.tracks = next;
  }, []);

  const commitSetlists = useCallback((next: Setlist[]) => {
    setSetlists(next);
    saveSetlists(next);
    lastSavedStateRef.current.setlists = next;
  }, []);

  useEffect(() => {
    if (lastSavedStateRef.current.tracks === tracks) return;
    const id = window.setTimeout(() => {
      saveTracks(tracks);
      lastSavedStateRef.current.tracks = tracks;
    }, 200);
    return () => window.clearTimeout(id);
  }, [tracks]);

  useEffect(() => {
    if (lastSavedStateRef.current.setlists === setlists) return;
    const id = window.setTimeout(() => {
      saveSetlists(setlists);
      lastSavedStateRef.current.setlists = setlists;
    }, 200);
    return () => window.clearTimeout(id);
  }, [setlists]);

  useEffect(() => {
    if (lastSavedStateRef.current.settings === settings) return;
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
      if (saved.activeTrackId !== s.activeTrackId || saved.activeSetlistId !== s.activeSetlistId) {
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
      if (inflight) return inflight;

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

  const updateActiveTrack = useCallback((updater: (track: PracticeTrack) => PracticeTrack) => {
    const targetId = activeTrackIdRef.current;
    setTracks((prev) => prev.map((tr) => (tr.id === targetId ? updater(tr) : tr)));
  }, []);

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

  const pauseAudio = audio.pause;
  const prefetchTracks = audio.prefetchTracks;
  const evictTrackCache = audio.evictTrackCache;
  const unlockAudio = audio.unlockAudio;
  const prewarmTrack = audio.prewarmTrack;
  const seekTo = audio.seekTo;

  useEffect(() => {
    if (activeTab === 'promo' && audio.isPlaying) {
      pauseAudio();
    }
  }, [activeTab, audio.isPlaying, pauseAudio]);

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

  const handleImportedFocusStudio = useCallback(() => {
    setActiveTab((curr) => (curr === 'setlists' || curr === 'playlistTracks' ? curr : 'studio'));
  }, []);

  const importer = useTrackImporter({
    tracksRef,
    activeSetlistIdRef,
    blobCacheRef,
    maxBlobCache,
    allTracksCustomOrderRef,
    setTracks,
    setSetlists,
    setActiveTrackId,
    onImportedFocusStudio: handleImportedFocusStudio,
    preparingLabel: t.uploadModal.preparingFiles,
    emptyErrorLabel: t.uploadModal.uploadEmptyError,
    storageErrorLabel: t.uploadModal.uploadStorageError,
  });

  // Smart prioritized pre-decoding around the active song & playlist
  useEffect(() => {
    if (!bootSplashDone || importer.isImporting) return;
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
    importer.isImporting,
    activeTab,
    activeSetlistTracks,
    currentTrackIndex,
    isMobileClient,
    prefetchTracks,
  ]);

  useEffect(() => {
    return () => {
      if (exportSuccessTimerRef.current !== null) {
        window.clearTimeout(exportSuccessTimerRef.current);
      }
    };
  }, []);

  const showExportSuccess = useCallback((message: string) => {
    if (exportSuccessTimerRef.current !== null) {
      window.clearTimeout(exportSuccessTimerRef.current);
    }
    setExportSuccessNotice(message);
    exportSuccessTimerRef.current = window.setTimeout(() => {
      setExportSuccessNotice(null);
      exportSuccessTimerRef.current = null;
    }, 3200);
  }, []);

  const audioExporter = useAudioExport({
    activeTrack,
    audioBuffer: audio.audioBuffer,
    swapLR: Boolean(settings.swapLR),
    isMobileClient,
    onExportError: importer.showImportError,
    onExportSuccess: showExportSuccess,
    exportErrorLabel: t.exportFailed,
    exportSavedLabel: t.exportSaved,
  });

  const handleCloseRename = useCallback(() => setPendingRenameTrack(null), []);
  const handleCloseDelete = useCallback(() => setPendingDeleteTrack(null), []);
  const handleOpenUploadModal = useCallback(() => setShowUploadModal(true), []);
  const handleCloseUploadModal = useCallback(() => setShowUploadModal(false), []);
  const handleReturnToRoot = useCallback(() => setActiveTab('studio'), []);

  const { showExitNotice, clearExitPrompt, ensureHistoryGuard } = useAndroidBackGuard({
    isAtRoot: activeTab === 'studio',
    hasPendingRename: Boolean(pendingRenameTrack),
    hasPendingDelete: Boolean(pendingDeleteTrack),
    hasReadyExport: Boolean(audioExporter.readyExport),
    showUploadModal,
    onCloseRename: handleCloseRename,
    onCloseDelete: handleCloseDelete,
    onCloseReadyExport: audioExporter.clearReadyExport,
    onCloseUploadModal: handleCloseUploadModal,
    onReturnToRoot: handleReturnToRoot,
  });

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

  // Setlist & Track Actions
  const handleCreateSetlist = useCallback((name: string) => {
    const id = `setlist-${Date.now()}`;
    setSetlists((prev) => [...prev, { id, name, description: '', trackIds: [], isCustomOrder: false }]);
    setActiveSetlistId(id);
    saveActiveIds(activeTrackIdRef.current, id);
  }, []);

  const handleDeleteSetlist = useCallback(
    (id: string) => {
      sessionEditedSetlistsRef.current.delete(id);
      const next = setlistsRef.current.filter((s) => s.id !== id);
      commitSetlists(next);
      if (activeSetlistIdRef.current === id) {
        const fallbackId = next[0]?.id || 'all';
        setActiveSetlistId(fallbackId);
        saveActiveIds(activeTrackIdRef.current, fallbackId);
      }
    },
    [commitSetlists]
  );

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

  const handleMoveTrackInSetlist = useCallback(
    (setlistId: string, trackId: string, dir: -1 | 1) => {
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
      commitSetlists(next);
    },
    [commitSetlists]
  );

  const handleSortSetlistAlphabetical = useCallback(
    (setlistId: string) => {
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
        commitTracks(sorted);
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
      commitSetlists(next);
    },
    [commitSetlists, commitTracks]
  );

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
        commitTracks(next);
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
      commitSetlists(next);
    },
    [commitSetlists, commitTracks, previousAllTrackIds]
  );

  const handleDeleteTrack = useCallback(
    async (trackId: string) => {
      inflightBlobRef.current.delete(trackId);
      blobCacheRef.current.delete(trackId);
      evictTrackCache(trackId);
      try {
        await deleteAudioBlobFromDB(trackId);
      } catch {
        // Metadata removal still proceeds even if blob was already evicted
      }

      const nextTracks = tracksRef.current.filter((tr) => tr.id !== trackId);
      commitTracks(nextTracks);
      setPreviousAllTrackIds((prev) => (prev ? prev.filter((id) => id !== trackId) : null));

      const nextSetlists = setlistsRef.current.map((sl) => ({
        ...sl,
        trackIds: sl.trackIds.filter((id) => id !== trackId),
        previousTrackIds: sl.previousTrackIds?.filter((id) => id !== trackId),
      }));
      commitSetlists(nextSetlists);

      if (activeTrackIdRef.current === trackId) {
        lastPrevClickRef.current = 0;
        const activeInPlaylist = activeSetlistTracksRef.current.find((tr) => tr.id !== trackId)?.id;
        const nextId = activeInPlaylist || nextTracks[0]?.id || '';
        setActiveTrackId(nextId);
        saveActiveIds(nextId, activeSetlistIdRef.current);
      }
    },
    [commitSetlists, commitTracks, evictTrackCache]
  );

  const handleReorderActivePlaylist = useCallback(
    (orderedIds: string[]) => {
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
        commitSetlists(next);
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
        commitTracks(next);
      }
    },
    [commitSetlists, commitTracks]
  );

  const audioActionsRef = useRef({
    isPlaying: audio.isPlaying,
    currentTime: audio.currentTime,
    play: audio.play,
    pause: audio.pause,
    seekTo: audio.seekTo,
    unlockAudio: audio.unlockAudio,
    prewarmTrack: audio.prewarmTrack,
  });
  audioActionsRef.current.isPlaying = audio.isPlaying;
  audioActionsRef.current.currentTime = audio.currentTime;
  audioActionsRef.current.play = audio.play;
  audioActionsRef.current.pause = audio.pause;
  audioActionsRef.current.seekTo = audio.seekTo;
  audioActionsRef.current.unlockAudio = audio.unlockAudio;
  audioActionsRef.current.prewarmTrack = audio.prewarmTrack;

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
        else void act.play();
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

  const activeSetlistName = useMemo(() => {
    if (activeSetlistId === 'all') return t.setlists.allTracks;
    return setlists.find((sl) => sl.id === activeSetlistId)?.name || t.setlists.allTracks;
  }, [activeSetlistId, setlists, t.setlists.allTracks]);

  // Media Session integration for Bluetooth pedals, headsets, lockscreen, and desktop media keys
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    if (!ms) return;

    if (typeof window.MediaMetadata === 'function' && activeTrack) {
      try {
        ms.metadata = new window.MediaMetadata({
          title: activeTrack.title,
          artist: t.appName,
          album: activeSetlistId === 'all' ? t.setlists.allTracks : activeSetlistName,
          artwork: [
            { src: '/icon-192-v12.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512-v12.png', sizes: '512x512', type: 'image/png' },
          ],
        });
      } catch {
        // ignore environments without MediaMetadata support
      }
    }

    try {
      ms.playbackState = audio.isPlaying ? 'playing' : 'paused';
    } catch {
      // ignore
    }
  }, [activeTrack, activeSetlistId, activeSetlistName, audio.isPlaying, t.appName, t.setlists.allTracks]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    if (!ms || typeof ms.setActionHandler !== 'function') return;

    const trySetHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // unsupported action in this browser/WebView
      }
    };

    trySetHandler('play', () => {
      void audioActionsRef.current.play();
    });
    trySetHandler('pause', () => {
      audioActionsRef.current.pause();
    });
    trySetHandler('stop', () => {
      audio.stop();
    });
    trySetHandler('previoustrack', () => {
      const list = activeSetlistTracksRef.current;
      if (list.length === 0) return;
      const idx = list.findIndex((tr) => tr.id === activeTrackIdRef.current);
      const base = idx >= 0 ? idx : 0;
      const prevIdx = (base - 1 + list.length) % list.length;
      autoPlayOnLoadRef.current = audioActionsRef.current.isPlaying;
      setActiveTrackId(list[prevIdx].id);
    });
    trySetHandler('nexttrack', () => {
      const list = activeSetlistTracksRef.current;
      if (list.length === 0) return;
      const idx = list.findIndex((tr) => tr.id === activeTrackIdRef.current);
      const base = idx >= 0 ? idx : 0;
      const nextIdx = (base + 1) % list.length;
      autoPlayOnLoadRef.current = audioActionsRef.current.isPlaying;
      setActiveTrackId(list[nextIdx].id);
    });
    trySetHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') {
        audioActionsRef.current.seekTo(details.seekTime);
      }
    });

    return () => {
      trySetHandler('play', null);
      trySetHandler('pause', null);
      trySetHandler('stop', null);
      trySetHandler('previoustrack', null);
      trySetHandler('nexttrack', null);
      trySetHandler('seekto', null);
    };
  }, [audio.stop]);

  const handleSelectSetlistInStudio = useCallback(
    (nextId: string) => {
      audioActionsRef.current.unlockAudio();
      const changedSetlist = nextId !== activeSetlistIdRef.current;
      setActiveSetlistId(nextId);

      if (changedSetlist) {
        const shouldPickFirst = !isAndroidClient || !activeTrackIdRef.current;
        const firstValid = shouldPickFirst
          ? resolveFirstValidTrackId(nextId, tracksRef.current, setlistsRef.current)
          : undefined;
        if (firstValid) {
          setActiveTrackId(firstValid);
          saveActiveIds(firstValid, nextId);
        } else {
          saveActiveIds(activeTrackIdRef.current, nextId);
        }
      }

      if (isAndroidClient) {
        navigateToTab('playlistTracks');
      }
    },
    [isAndroidClient, navigateToTab]
  );

  const playOrSelectTrack = useCallback((id: string) => {
    const act = audioActionsRef.current;
    act.unlockAudio();
    if (id === activeTrackIdRef.current) {
      void act.play(0);
    } else {
      act.prewarmTrack(id);
      autoPlayOnLoadRef.current = true;
      setActiveTrackId(id);
    }
  }, []);

  const handleSelectTrackInDropdown = useCallback(
    (id: string) => {
      playOrSelectTrack(id);
      if (activeTabRef.current !== 'studio') {
        navigateToTab('studio');
      }
    },
    [navigateToTab, playOrSelectTrack]
  );

  const handleOpenPlaylistTracksView = useCallback(() => {
    audioActionsRef.current.unlockAudio();
    navigateToTab('playlistTracks');
  }, [navigateToTab]);

  const handleSeek = useCallback((time: number) => seekTo(time), [seekTo]);
  const handleNoop = useCallback(() => {}, []);

  const handleSettingsUpdate = useCallback((patch: Partial<StudioSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      lastSavedStateRef.current.settings = next;
      return next;
    });
  }, []);

  const handleToggleSwapLR = useCallback(() => {
    setSettings((s) => {
      const next = { ...s, swapLR: !s.swapLR };
      saveSettings(next);
      lastSavedStateRef.current.settings = next;
      return next;
    });
  }, []);

  const handleSettingsReset = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
    lastSavedStateRef.current.settings = DEFAULT_SETTINGS;
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

  const handleRequestRenameTrack = useCallback((track: PracticeTrack) => {
    setPendingRenameTrack(track);
    setRenameTitleInput(track.title);
  }, []);

  const handleConfirmRenameTrack = useCallback(() => {
    const target = pendingRenameTrackRef.current;
    if (!target) return;
    const trimmed = renameTitleInput.trim();
    if (!trimmed) return;

    if (trimmed !== target.title) {
      const nextTracks = tracksRef.current.map((tr) =>
        tr.id === target.id ? { ...tr, title: trimmed } : tr
      );
      commitTracks(nextTracks);
    }
    setPendingRenameTrack(null);
  }, [commitTracks, renameTitleInput]);

  const handleOpenTrackPicker = useCallback(
    () => uploadModalRef.current?.openAddMusicPicker({ isNewPlaylist: false }),
    []
  );

  const handleSetlistOpenUploadModal = useCallback((isNewPlaylist?: boolean) => {
    uploadModalRef.current?.openAddMusicPicker({ isNewPlaylist });
  }, []);

  const handleOpenPromoSite = useCallback(() => navigateToTab('promo'), [navigateToTab]);

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
    if (prev.length === tracks.length && tracks.every((tr, i) => prev[i] === tr.title)) {
      return prev;
    }
    const next = tracks.map((tr) => tr.title);
    existingTitlesCacheRef.current = next;
    return next;
  }, [tracks]);

  const handleTouchStartMain = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (
        e.touches.length !== 1 ||
        pendingDeleteTrack ||
        pendingRenameTrack ||
        audioExporter.readyExport ||
        showUploadModal
      ) {
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
    [pendingDeleteTrack, pendingRenameTrack, audioExporter.readyExport, showUploadModal]
  );

  const handleTouchEndMain = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
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
        if (curr === 'playlistTracks' || curr === 'promo') return;
        const idx = MAIN_TAB_ORDER.indexOf(curr);
        if (dx < 0 && idx >= 0 && idx < MAIN_TAB_ORDER.length - 1) {
          navigateToTab(MAIN_TAB_ORDER[idx + 1]);
        } else if (dx > 0 && idx > 0) {
          navigateToTab(MAIN_TAB_ORDER[idx - 1]);
        }
      }
    },
    [navigateToTab]
  );

  const activePlaylistTrackId = useMemo(
    () =>
      activeSetlistTracks.some((tr) => tr.id === activeTrack?.id)
        ? activeTrack?.id || ''
        : activeSetlistTracks[0]?.id || '',
    [activeSetlistTracks, activeTrack?.id]
  );

  if (activeTab === 'promo' && !isNativeShell) {
    return (
      <PromoWebsiteView
        language={settings.language}
        onChangeLanguage={(lang) => handleSettingsUpdate({ language: lang })}
        onOpenPlayer={() => {
          clearPromoRouteFlag();
          navigateToTab('studio');
        }}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-[var(--surface-base)] text-slate-900 dark:text-zinc-100">
      <AppHeader
        activeTab={activeTab}
        isMobileLandscape={isMobileLandscape}
        isNativeShell={isNativeShell}
        headerLogoDataUrl={settings.headerLogoDataUrl}
        headerBrandMode={settings.headerBrandMode}
        t={t}
        onNavigateTab={navigateToTab}
      />

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
                    disabled={importer.isImporting}
                    className="min-h-[40px] px-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-70 text-[var(--accent-fg)] text-xs sm:text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer active:scale-[0.98] transition-transform"
                  >
                    {importer.isImporting ? (
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 shrink-0" />
                    )}
                    <span>
                      {importer.isImporting
                        ? importer.importStatus
                          ? `${t.uploadModal.uploadingShort} (${importer.importStatus.current}/${importer.importStatus.total})`
                          : t.uploadModal.uploadingShort
                        : t.importAudio}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void audioExporter.handleExportAudio()}
                    disabled={
                      !activeTrack ||
                      !audio.audioBuffer ||
                      audio.isLoadingAudio ||
                      audioExporter.isExporting
                    }
                    className="min-h-[40px] px-3 rounded-xl bg-[var(--surface-card)] hover:bg-[var(--surface-control)] border border-[var(--surface-border-subtle)] hover:border-amber-500/60 disabled:opacity-40 text-slate-900 dark:text-zinc-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer active:scale-[0.98] transition-all shadow-sm dark:shadow-none"
                  >
                    <Download className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>
                      {audioExporter.isExporting
                        ? `${t.exporting}${audioExporter.exportProgress > 0 ? ` ${audioExporter.exportProgress}%` : ''}`
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
                  {/* Track Selector & Prev/Next */}
                  <section className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-2.5 flex flex-col gap-2 shadow-sm dark:shadow-none">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onPointerDown={() => {
                          if (activeSetlistTracks.length <= 1) return;
                          const baseIdx = currentTrackIndex >= 0 ? currentTrackIndex : 0;
                          const prevIdx =
                            (baseIdx - 1 + activeSetlistTracks.length) % activeSetlistTracks.length;
                          prewarmTrack(activeSetlistTracks[prevIdx].id);
                        }}
                        onClick={() => {
                          if (activeSetlistTracks.length === 0) return;
                          unlockAudio();
                          const now = Date.now();
                          const isSecondClick = now - lastPrevClickRef.current < 2000;

                          if (!isSecondClick || activeSetlistTracks.length === 1) {
                            lastPrevClickRef.current = now;
                            void audio.play(0);
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
                        className="min-h-[42px] px-3 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center gap-1 text-xs font-medium text-slate-800 dark:text-zinc-200 hover:border-slate-400 dark:hover:border-zinc-500 disabled:opacity-30 shrink-0 cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>{t.live.prevTrack}</span>
                      </button>

                      <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-zinc-400">
                        {currentTrackIndex >= 0
                          ? `${currentTrackIndex + 1} / ${activeSetlistTracks.length}`
                          : ''}
                      </span>

                      <button
                        type="button"
                        onPointerDown={() => {
                          if (activeSetlistTracks.length <= 1) return;
                          const baseIdx = currentTrackIndex >= 0 ? currentTrackIndex : 0;
                          const nextIdx = (baseIdx + 1) % activeSetlistTracks.length;
                          prewarmTrack(activeSetlistTracks[nextIdx].id);
                        }}
                        onClick={() => {
                          if (activeSetlistTracks.length === 0) return;
                          lastPrevClickRef.current = 0;
                          unlockAudio();
                          if (activeSetlistTracks.length === 1) {
                            void audio.play(0);
                            return;
                          }
                          const baseIdx = currentTrackIndex >= 0 ? currentTrackIndex : 0;
                          const nextIdx = (baseIdx + 1) % activeSetlistTracks.length;
                          autoPlayOnLoadRef.current = true;
                          setActiveTrackId(activeSetlistTracks[nextIdx].id);
                        }}
                        disabled={activeSetlistTracks.length === 0}
                        className="min-h-[42px] px-3 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center gap-1 text-xs font-medium text-slate-800 dark:text-zinc-200 hover:border-slate-400 dark:hover:border-zinc-500 disabled:opacity-30 shrink-0 cursor-pointer"
                      >
                        <span>{t.live.nextTrack}</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <PlaylistTrackDropdown
                      tracks={activeSetlistTracks}
                      activeTrackId={activePlaylistTrackId}
                      isAlphabetical={isActivePlaylistAlphabetical}
                      canResetOrder={canResetActiveOrder}
                      t={t}
                      onSelectTrack={handleSelectTrackInDropdown}
                      onReorderTracks={handleReorderActivePlaylist}
                      onSortAlphabetical={handleSortActivePlaylistAlphabetical}
                      onResetOrder={handleResetActivePlaylistOrder}
                      onRequestRenameTrack={handleRequestRenameTrack}
                      onRequestDeleteTrack={handleRequestDeleteTrack}
                      onOpenFullView={isAndroidClient ? handleOpenPlaylistTracksView : undefined}
                      onUnlockAudio={unlockAudio}
                      onPrewarmTrack={prewarmTrack}
                      onPrefetchTracks={prefetchTracks}
                    />
                  </section>

                  {/* Waveform + Timecode + Manual/Auto Switch */}
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
                          type="button"
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
                          type="button"
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

                  {/* Thumb-Zone Transport Bar */}
                  <div
                    className={
                      isMobileLandscape
                        ? 'static p-0 bg-transparent border-0'
                        : 'fixed bottom-0 left-0 right-0 z-30 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-[var(--surface-base-translucent)] backdrop-blur-md border-t border-[var(--surface-border-subtle)] sm:static sm:p-0 sm:bg-transparent sm:backdrop-blur-none sm:border-0'
                    }
                  >
                    <div className="max-w-xl mx-auto grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={audio.stop}
                        className="min-h-[54px] rounded-xl bg-[var(--surface-card)] dark:bg-[var(--surface-control)] border border-[var(--surface-border)] text-slate-800 dark:text-zinc-200 hover:border-slate-400 dark:hover:border-zinc-500 font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition-transform shadow-sm dark:shadow-none"
                      >
                        {audio.currentTime > 0 && !audio.isPlaying ? (
                          <RotateCcw className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4 fill-current" />
                        )}
                        <span>{t.transport.stop}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (audio.isPlaying) pauseAudio();
                          else void audio.play();
                        }}
                        disabled={audio.isLoadingAudio}
                        className="col-span-2 min-h-[54px] rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] font-bold text-base flex items-center justify-center gap-2.5 cursor-pointer active:scale-[0.98] transition-transform shadow-sm dark:shadow-none"
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

            {/* Right Column: Live Controls (Pitch + BPM + L/R Volumes) */}
            {activeTrack && (
              <LiveControlsPanel
                preset={activeTrack.preset}
                swapLR={Boolean(settings.swapLR)}
                t={t}
                onUpdatePreset={updatePreset}
                onToggleSwapLR={handleToggleSwapLR}
              />
            )}
          </div>
        )}

        {activeTab === 'playlistTracks' && (
          <PlaylistTracksView
            playlistName={activeSetlistName}
            tracks={activeSetlistTracks}
            activeTrackId={activePlaylistTrackId}
            isPlaying={audio.isPlaying}
            isImporting={importer.isImporting}
            isAlphabetical={isActivePlaylistAlphabetical}
            canResetOrder={canResetActiveOrder}
            t={t}
            onBack={handleReturnToRoot}
            onSelectTrack={playOrSelectTrack}
            onReorderTracks={handleReorderActivePlaylist}
            onSortAlphabetical={handleSortActivePlaylistAlphabetical}
            onResetOrder={handleResetActivePlaylistOrder}
            onRequestRenameTrack={handleRequestRenameTrack}
            onRequestDeleteTrack={handleRequestDeleteTrack}
            onUploadTracks={handleOpenTrackPicker}
            onPrewarmTrack={prewarmTrack}
            onPrefetchTracks={prefetchTracks}
          />
        )}

        {activeTab === 'setlists' && (
          <SetlistsView
            t={t}
            tracks={tracks}
            setlists={setlists}
            activeTrackId={activeTrack?.id || ''}
            isPlaying={audio.isPlaying}
            isImporting={importer.isImporting}
            onSelectTrack={playOrSelectTrack}
            onSelectSetlist={setActiveSetlistId}
            onCreateSetlist={handleCreateSetlist}
            onDeleteSetlist={handleDeleteSetlist}
            onToggleTrackInSetlist={handleToggleTrackInSetlist}
            onMoveTrackInSetlist={handleMoveTrackInSetlist}
            onSortSetlistAlphabetical={handleSortSetlistAlphabetical}
            onResetSetlistOrder={handleResetSetlistOrder}
            onRequestRenameTrack={handleRequestRenameTrack}
            onOpenUploadModal={handleSetlistOpenUploadModal}
            onPrewarmTrack={prewarmTrack}
            onPrefetchTracks={prefetchTracks}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            t={t}
            settings={settings}
            onUpdate={handleSettingsUpdate}
            onResetDefaults={handleSettingsReset}
            onOpenPromoSite={!isNativeShell ? handleOpenPromoSite : undefined}
          />
        )}
      </main>

      <StudioModals
        t={t}
        isMobileClient={isMobileClient}
        pendingDeleteTrack={pendingDeleteTrack}
        onCancelDelete={handleCloseDelete}
        onConfirmDelete={handleDeleteTrack}
        pendingRenameTrack={pendingRenameTrack}
        renameTitleInput={renameTitleInput}
        onRenameInputChange={setRenameTitleInput}
        onCancelRename={handleCloseRename}
        onConfirmRename={handleConfirmRenameTrack}
        readyExport={audioExporter.readyExport}
        canShareExportFile={audioExporter.canShareExportFile}
        onClearReadyExport={audioExporter.clearReadyExport}
        onShareExport={audioExporter.handleShareExport}
        onChooseSaveLocation={audioExporter.handleChooseSaveLocation}
        onTriggerDirectDownload={audioExporter.triggerDirectDownload}
        onScheduleExportCleanup={audioExporter.scheduleReadyExportCleanup}
        isImporting={importer.isImporting}
        importStatus={importer.importStatus}
        importSuccessCount={importer.importSuccessCount}
        importErrorNotice={importer.importErrorNotice}
        exportSuccessNotice={exportSuccessNotice}
        showExitNotice={showExitNotice}
      />

      <UploadTracksModal
        ref={uploadModalRef}
        open={showUploadModal}
        t={t}
        existingTitles={existingTitles}
        isImporting={importer.isImporting}
        onRequestOpen={handleOpenUploadModal}
        onClose={handleCloseUploadModal}
        onPreparingImport={importer.handlePreparingImport}
        onImportEmpty={importer.handleImportEmpty}
        onImportFiles={importer.handleImportFiles}
      />

      <AndroidDirectInstallerSheet t={t} ready={bootSplashDone} />
      <OfflineIndicator t={t} />
    </div>
  );
}
