export type SectionType =
  | 'intro'
  | 'verse'
  | 'chorus'
  | 'riff'
  | 'solo'
  | 'bridge'
  | 'outro'
  | 'custom';

export interface SongSection {
  id: string;
  label: string;
  type: SectionType;
  startTime: number;
  endTime: number;
  color: string;
}

export interface TrackPreset {
  speed: number; // 0.25 to 2.50
  pitchSemitones: number; // -12 to +12
  pitchCents: number; // -50 to +50
  volumeL?: number; // 0 to 1 (Left channel / P10 L)
  volumeR?: number; // 0 to 1 (Right channel / P10 R)
  bpm: number;
  beatsPerBar: number;
  beatOffset: number; // seconds to first downbeat
  loopA: number | null;
  loopB: number | null;
  loopEnabled: boolean;
  lastPosition: number;
}

export interface PracticeTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  source: 'builtin' | 'local';
  builtinKey?: 'rock' | 'worship' | 'funk' | 'blues';
  mimeType?: string;
  preset: TrackPreset;
  sections: SongSection[];
  lyricsRaw: string;
  notes: string;
  createdAt: number;
}

export interface Setlist {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  previousTrackIds?: string[];
  isCustomOrder?: boolean;
}

export type ClickSound = 'stick' | 'hihat' | 'digital';
export type SnapMode = 'off' | 'beat' | 'bar';
export type AutoRewindMode = 'none' | '1s' | '2s' | 'loopA';
export type HeaderBrandMode = 'name' | 'logo' | 'both';
export type AppTheme = 'dark' | 'light';
export type AppColorPalette = 'amber' | 'crimson' | 'mint' | 'cobalt';

export interface StudioSettings {
  language: 'pt' | 'en';
  theme?: AppTheme;
  colorPalette?: AppColorPalette;
  defaultCountInBars: 0 | 1 | 2;
  clickSound: ClickSound;
  metronomeEnabled: boolean;
  metronomeVolume: number; // 0 to 1
  snapMode: SnapMode;
  autoRewindOnPause: AutoRewindMode;
  speedStepPercent: 5 | 10;
  seekStepSeconds: 2 | 5 | 10;
  stageMode: boolean; // larger touch buttons for tablet/phone stand
  showRehearsalTools: boolean; // optional Speed & A-B Loop controls
  autoAdvance: boolean; // false = stop at end (Manual), true = play next automatically
  swapLR?: boolean; // invert Left/Right outputs across all tracks
  headerLogoDataUrl?: string; // custom uploaded header logo data URL
  headerBrandMode?: HeaderBrandMode; // 'name' | 'logo' | 'both'
  autoStepUpEnabled: boolean;
  autoStepUpIncrement: number; // e.g. 5 (%)
  autoStepUpEveryLoops: number; // e.g. 2 loops
  autoStepUpTarget: number; // e.g. 100 (%)
  loopGapSeconds: number; // 0 to 3s pause between A-B loops
  followPlayhead: boolean;
}
