import {
  AppColorPalette,
  AppTheme,
  PracticeTrack,
  Setlist,
  SongSection,
  StudioSettings,
  TrackPreset,
} from '../types/studio';

export const EMPTY_SECTIONS: SongSection[] = [];

export const PALETTE_META_THEME_COLORS: Record<
  AppColorPalette,
  { dark: string; light: string }
> = {
  amber: { dark: '#000000', light: '#F4F5F7' },
  crimson: { dark: '#111219', light: '#F6F4F6' },
  mint: { dark: '#1E2228', light: '#F2F6F4' },
  cobalt: { dark: '#0B0F17', light: '#F2F5FA' },
};

export const FALLBACK_PRESET: TrackPreset = {
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

export function resolveThemeAndPalette(settings: StudioSettings): {
  activeTheme: AppTheme;
  activePalette: AppColorPalette;
} {
  const activeTheme: AppTheme = settings.theme === 'light' ? 'light' : 'dark';
  const activePalette: AppColorPalette =
    settings.colorPalette === 'crimson' ||
    settings.colorPalette === 'mint' ||
    settings.colorPalette === 'cobalt'
      ? settings.colorPalette
      : 'amber';
  return { activeTheme, activePalette };
}

export function compareTrackTitles(a: PracticeTrack, b: PracticeTrack): number {
  return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortTrackIdsByTitle(ids: string[], trackList: PracticeTrack[]): string[] {
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

export function areTracksAlphabetical(list: PracticeTrack[]): boolean {
  if (list.length <= 1) return true;
  for (let i = 1; i < list.length; i++) {
    if (compareTrackTitles(list[i - 1], list[i]) > 0) return false;
  }
  return true;
}

export function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function resolveFirstValidTrackId(
  setlistId: string,
  tracks: PracticeTrack[],
  setlists: Setlist[]
): string | undefined {
  if (setlistId === 'all') {
    return tracks[0]?.id;
  }
  const sl = setlists.find((s) => s.id === setlistId);
  if (!sl) return undefined;
  const trackIds = new Set(tracks.map((tr) => tr.id));
  return sl.trackIds.find((id) => trackIds.has(id));
}

export function stripFileExtension(fileName: string, fallback = ''): string {
  const stripped = fileName.replace(/\.[^/.]+$/, '');
  return stripped || fallback;
}

export function sanitizeExportFileName(title: string): string {
  const safeTitle =
    title
      .replace(/[/\\?%*:|"<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'musica';
  return `${safeTitle} - Ajustada.wav`;
}

let trackSeqCounter = 0;

export function createTrackId(index = 0): string {
  trackSeqCounter = (trackSeqCounter + 1) % 100000;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Date.now()}-${index}-${trackSeqCounter}`;
}

export function createLocalTrack(params: {
  id: string;
  title: string;
  duration: number;
  mimeType: string;
  bpm?: number;
  beatOffset?: number;
  createdAt: number;
}): PracticeTrack {
  return {
    id: params.id,
    title: params.title,
    artist: 'VS / Palco',
    duration: params.duration,
    source: 'local',
    mimeType: params.mimeType,
    preset: {
      speed: 1,
      pitchSemitones: 0,
      pitchCents: 0,
      volumeL: 1,
      volumeR: 1,
      bpm: params.bpm ?? 120,
      beatsPerBar: 4,
      beatOffset: params.beatOffset ?? 0,
      loopA: null,
      loopB: null,
      loopEnabled: false,
      lastPosition: 0,
    },
    sections: [],
    lyricsRaw: '',
    notes: '',
    createdAt: params.createdAt,
  };
}

export function readAudioDurationFast(file: File, timeoutMs = 1000): Promise<number> {
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
