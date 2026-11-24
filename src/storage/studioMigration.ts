import { createInitialDemoTracks, createInitialSetlists } from '../audio/demoTracks';
import { PracticeTrack, Setlist, StudioSettings } from '../types/studio';
import { arraysEqual, sortTrackIdsByTitle } from '../utils/trackUtils';
import {
  loadActiveIds,
  loadSavedSetlists,
  loadSavedTracks,
  loadSettings,
  saveSetlists,
  saveTracks,
} from './studioStorage';

const DEMO_LR_MIGRATION_KEY = 'rivera_vs_demo_lr_v1';
const LEGACY_DEMO_LR_MIGRATION_KEY = 'riffforge_demo_lr_v1';

export interface InitialStudioData {
  baseTracks: PracticeTrack[];
  migratedSetlists: Setlist[];
  savedSettings: StudioSettings;
  initialTrackId: string;
  initialSetlistId: string;
}

export function loadInitialStudioData(): InitialStudioData {
  const demoDefaults = createInitialDemoTracks();
  const demoById = new Map(demoDefaults.map((tr) => [tr.id, tr]));

  let baseTracks = loadSavedTracks() || demoDefaults;
  let loadedSetlists = loadSavedSetlists() || createInitialSetlists();
  const activeIds = loadActiveIds();
  const nextInitialTrackId =
    activeIds.trackId === 'demo-blues-a' ? 'demo-worship-g' : activeIds.trackId;

  let needsDemoMigration = false;
  try {
    if (typeof localStorage !== 'undefined') {
      const currentDone = localStorage.getItem(DEMO_LR_MIGRATION_KEY) === '1';
      const legacyDone = localStorage.getItem(LEGACY_DEMO_LR_MIGRATION_KEY) === '1';
      if (!currentDone && legacyDone) {
        try {
          localStorage.setItem(DEMO_LR_MIGRATION_KEY, '1');
        } catch {
          // ignore
        }
      }
      needsDemoMigration = !currentDone && !legacyDone;
    }
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
