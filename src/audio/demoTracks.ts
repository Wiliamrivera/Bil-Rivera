import { PracticeTrack, Setlist } from '../types/studio';
import { createAudioContextSafe } from '../utils/platform';
import { audioBufferToWavBlob } from './audioUtils';

export type DemoTrackKey = 'rock' | 'worship' | 'funk' | 'blues';

const LEAD_OFFSET_SEC = 0.02;

function resolveCanonicalKey(key: DemoTrackKey): 'rock' | 'worship' | 'funk' {
  return key === 'blues' ? 'worship' : key;
}

/**
 * Sample-accurate constant-timbre Click synthesized strictly on Channel L (left).
 * Identical sound on every beat (no alternating first-beat cowbell/accent) with 0 bleed into R.
 */
function addConstantClickL(left: Float32Array, sr: number, tSec: number, gain = 0.78) {
  const start = Math.floor(tSec * sr);
  const len = Math.floor(sr * 0.026);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= left.length) continue;
    const t = i / sr;
    const attack = t < 0.0012 ? t / 0.0012 : 1;
    const env = attack * Math.exp(-t * 165);
    const body =
      Math.sin(2 * Math.PI * 1320 * t) * 0.68 +
      Math.sin(2 * Math.PI * 2640 * t) * 0.24 +
      (t < 0.0018 ? Math.sin(2 * Math.PI * 3960 * t) * 0.22 * (1 - t / 0.0018) : 0);
    left[idx] += body * env * gain;
  }
}

/**
 * Drums & Instruments synthesized strictly on Channel R (right) with 0 bleed into L.
 */
function addKickR(right: Float32Array, sr: number, tSec: number, gain = 0.72) {
  const start = Math.floor(tSec * sr);
  const len = Math.floor(sr * 0.25);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= right.length) continue;
    const t = i / sr;
    const freq = 138 * Math.exp(-t * 30) + 45;
    const env = (t < 0.002 ? t / 0.002 : 1) * Math.exp(-t * 13);
    right[idx] += Math.sin(2 * Math.PI * freq * t) * env * gain;
  }
}

function addSnareR(right: Float32Array, sr: number, tSec: number, gain = 0.48, rim = false) {
  const start = Math.floor(tSec * sr);
  const len = Math.floor(sr * (rim ? 0.085 : 0.2));
  let seed = (start % 9973) + 1;
  let prevNoise = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= right.length) continue;
    const t = i / sr;
    seed = (seed * 16807) % 2147483647;
    const white = seed / 1073741823.5 - 1;
    const crispNoise = white - prevNoise * 0.55;
    prevNoise = white;
    const body = Math.sin(2 * Math.PI * (rim ? 410 : 186) * t) * Math.exp(-t * (rim ? 42 : 22));
    const snap = crispNoise * Math.exp(-t * (rim ? 48 : 19));
    right[idx] += (body * 0.56 + snap * (rim ? 0.32 : 0.58)) * gain;
  }
}

function addHatR(right: Float32Array, sr: number, tSec: number, gain = 0.14, open = false) {
  const start = Math.floor(tSec * sr);
  const len = Math.floor(sr * (open ? 0.22 : 0.052));
  let seed = (start % 7919) + 17;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= right.length) continue;
    const t = i / sr;
    seed = (seed * 48271) % 2147483647;
    const white = seed / 1073741823.5 - 1;
    const hp = white - prev * 0.86;
    prev = white;
    right[idx] += hp * Math.exp(-t * (open ? 12 : 52)) * gain;
  }
}

function addToneR(
  right: Float32Array,
  sr: number,
  tSec: number,
  durSec: number,
  freq: number,
  gain: number,
  timbre: 'bass' | 'guitar' | 'epiano' | 'pad' | 'lead'
) {
  const start = Math.floor(tSec * sr);
  const len = Math.floor(durSec * sr);
  const fadeOutSamples = Math.max(1, Math.floor(sr * (timbre === 'pad' ? 0.12 : 0.03)));

  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= right.length) continue;
    const t = i / sr;
    const attack = timbre === 'pad' ? Math.min(1, t / 0.14) : Math.min(1, t / 0.01);
    const release = i > len - fadeOutSamples ? (len - i) / fadeOutSamples : 1;
    const decay =
      timbre === 'pad'
        ? Math.exp(-t * 0.45)
        : timbre === 'epiano'
          ? Math.exp(-t * 2.4)
          : timbre === 'guitar'
            ? Math.exp(-t * 4.2)
            : Math.exp(-t * 1.7);
    const env = attack * release * decay;

    let sample = 0;
    if (timbre === 'bass') {
      sample =
        Math.sin(2 * Math.PI * freq * t) * 0.74 +
        Math.sin(4 * Math.PI * freq * t) * 0.22 +
        Math.sin(6 * Math.PI * freq * t) * 0.07;
    } else if (timbre === 'guitar') {
      const bright = Math.exp(-t * 7.5);
      const raw =
        Math.sin(2 * Math.PI * freq * t) * 0.56 +
        Math.sin(4 * Math.PI * freq * t) * (0.28 + 0.22 * bright) +
        Math.sin(6 * Math.PI * freq * t) * (0.16 * bright) +
        Math.sin(8 * Math.PI * freq * t) * (0.1 * bright);
      sample = Math.tanh(raw * 1.65) * 0.68;
    } else if (timbre === 'pad') {
      const detune = Math.sin(2 * Math.PI * (freq * 1.003) * t);
      sample =
        (Math.sin(2 * Math.PI * freq * t) * 0.55 +
          detune * 0.35 +
          Math.sin(4 * Math.PI * freq * t) * 0.14) *
        0.72;
    } else if (timbre === 'lead') {
      const vib = Math.sin(2 * Math.PI * 5.2 * t) * (t > 0.12 ? 0.005 : 0);
      const f = freq * (1 + vib);
      const raw =
        Math.sin(2 * Math.PI * f * t) * 0.55 +
        Math.sin(4 * Math.PI * f * t) * 0.26 +
        Math.sin(6 * Math.PI * f * t) * 0.14;
      sample = Math.tanh(raw * 1.85) * 0.62;
    } else {
      sample =
        Math.sin(2 * Math.PI * freq * t) * 0.78 +
        Math.sin(4 * Math.PI * freq * t) * 0.18 * Math.exp(-t * 6.5) +
        Math.sin(6 * Math.PI * freq * t) * 0.05 * Math.exp(-t * 11);
    }

    right[idx] += sample * env * gain;
  }
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function getSpecForKey(key: 'rock' | 'worship' | 'funk') {
  if (key === 'worship') {
    return { bpm: 74, totalBars: 13 }; // 1 bar count-in (L) + 12 bars groove (R)
  }
  if (key === 'funk') {
    return { bpm: 102, totalBars: 17 }; // 1 bar count-in (L) + 16 bars groove (R)
  }
  return { bpm: 116, totalBars: 17 }; // 1 bar count-in (L) + 16 bars groove (R)
}

function createStereoDemoBuffer(length: number, sampleRate: number): AudioBuffer {
  try {
    return new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
  } catch {
    const ctx = createAudioContextSafe({ sampleRate });
    if (!ctx) {
      throw new Error('AudioContext unavailable for demo synthesis');
    }
    const buf = ctx.createBuffer(2, length, sampleRate);
    ctx.close().catch(() => {});
    return buf;
  }
}

function buildDemoBufferSkeleton(key: DemoTrackKey) {
  const canonical = resolveCanonicalKey(key);
  const sr = 44100;
  const { bpm, totalBars } = getSpecForKey(canonical);

  const beat = 60 / bpm;
  const bar = beat * 4;
  const totalSec = LEAD_OFFSET_SEC + totalBars * bar + 0.3;
  const length = Math.floor(totalSec * sr);

  const buffer = createStereoDemoBuffer(length, sr);
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  return { canonical, buffer, L, R, sr, beat, bar, totalBars, length };
}

function renderDemoBar(
  key: 'rock' | 'worship' | 'funk',
  b: number,
  L: Float32Array,
  R: Float32Array,
  sr: number,
  beat: number,
  bar: number
) {
  const t0 = LEAD_OFFSET_SEC + b * bar;

  // Channel L: strictly constant quarter-note Click across the entire track (including Bar 0 count-in)
  for (let q = 0; q < 4; q++) {
    addConstantClickL(L, sr, t0 + q * beat, 0.78);
  }

  // Bar 0 is pure 4-beat Click count-in (R stays silent until bar 1 drops in)
  if (b === 0) return;

  const grooveBar = b - 1;

  if (key === 'rock') {
    // Arena Pop Rock in Em (116 BPM) -> Em - C - G - D progression
    const bassProg = [40, 40, 36, 38, 40, 40, 43, 38];
    const chordProg = [52, 52, 48, 50, 52, 52, 55, 50];
    const root = bassProg[grooveBar % bassProg.length];
    const chordRoot = chordProg[grooveBar % chordProg.length];
    const isIntro = grooveBar < 2;
    const isChorus = grooveBar >= 6 && grooveBar < 14;

    for (let q = 0; q < 4; q++) {
      const qt = t0 + q * beat;
      addHatR(R, sr, qt, 0.14, false);
      addHatR(R, sr, qt + beat * 0.5, 0.1, q === 3 && grooveBar % 4 === 3);
      if (q === 0 || q === 2) addKickR(R, sr, qt, 0.74);
      if (!isIntro && (q === 1 || q === 3)) addSnareR(R, sr, qt, 0.48, false);
      else if (isIntro && q === 3) addSnareR(R, sr, qt, 0.34, true);
    }
    if (!isIntro) {
      addKickR(R, sr, t0 + beat * 2.5, 0.55);
    }

    for (let e = 0; e < 8; e++) {
      const et = t0 + e * (beat * 0.5);
      const note = e === 7 && grooveBar % 2 === 1 ? root + 2 : root;
      addToneR(R, sr, et, beat * 0.46, midiToFreq(note), 0.35, 'bass');
    }

    const chordHits = isIntro ? [0, 2] : [0, 1, 1.5, 2.5, 3];
    chordHits.forEach((h) => {
      const ht = t0 + h * beat;
      addToneR(R, sr, ht, beat * 0.7, midiToFreq(chordRoot), 0.17, 'guitar');
      addToneR(R, sr, ht, beat * 0.7, midiToFreq(chordRoot + 7), 0.14, 'guitar');
    });

    if (isChorus) {
      const hook = [76, 74, 71, 74, 76, 79, 76, 74];
      for (let s = 0; s < 8; s++) {
        const m = hook[(s + grooveBar * 2) % hook.length];
        addToneR(R, sr, t0 + s * (beat * 0.5), beat * 0.44, midiToFreq(m), 0.16, 'lead');
      }
    }
  } else if (key === 'worship') {
    // Worship Atmosfera in G (74 BPM) -> G - D - Em7 - Cadd9
    const bassProg = [43, 42, 40, 36]; // G2, F#2, E2, C2
    const padThirds = [
      [55, 59, 62, 67], // G
      [54, 57, 62, 66], // D/F#
      [52, 55, 59, 64], // Em7
      [48, 55, 60, 62], // Cadd9
    ];
    const barIdx = grooveBar % 4;
    const root = bassProg[barIdx];
    const voicing = padThirds[barIdx];
    const isBuild = grooveBar >= 4;

    for (let q = 0; q < 4; q++) {
      const qt = t0 + q * beat;
      if (isBuild) {
        addHatR(R, sr, qt, 0.1, false);
        addHatR(R, sr, qt + beat * 0.5, 0.08, q === 3 && barIdx === 3);
      }
      if (q === 0 || (isBuild && q === 2)) addKickR(R, sr, qt, isBuild ? 0.68 : 0.52);
      if (q === 1 || q === 3) {
        addSnareR(R, sr, qt, isBuild ? 0.42 : 0.28, !isBuild);
      }
    }
    if (isBuild) {
      addKickR(R, sr, t0 + beat * 1.75, 0.45);
    }

    // Long sustained pad + warm electric piano chord swells
    voicing.forEach((m) => {
      addToneR(R, sr, t0, bar * 0.96, midiToFreq(m), 0.12, 'pad');
      addToneR(R, sr, t0, beat * 1.9, midiToFreq(m + 12), 0.075, 'epiano');
      if (isBuild) {
        addToneR(R, sr, t0 + beat * 2, beat * 1.8, midiToFreq(m + 12), 0.07, 'epiano');
      }
    });

    // Anchored sub/finger bass
    addToneR(R, sr, t0, beat * 1.9, midiToFreq(root), 0.36, 'bass');
    addToneR(R, sr, t0 + beat * 2, beat * 1.85, midiToFreq(root), 0.32, 'bass');

    // Gentle melodic arpeggio motif on chorus bars 4..11
    if (grooveBar >= 4 && grooveBar < 12) {
      const arp = [67, 71, 74, 79, 74, 71, 67, 74];
      for (let e = 0; e < 8; e++) {
        addToneR(R, sr, t0 + e * (beat * 0.5), beat * 0.48, midiToFreq(arp[e]), 0.11, 'epiano');
      }
    }
  } else {
    // Funk Groove in Dm (102 BPM) -> Dm9 - Gm9 - Am7 - C9
    const roots = [38, 38, 43, 45, 38, 38, 41, 43];
    const root = roots[grooveBar % roots.length];
    for (let s = 0; s < 8; s++) {
      addHatR(R, sr, t0 + s * (beat * 0.5), s % 2 === 0 ? 0.14 : 0.085, s === 7);
    }
    addKickR(R, sr, t0, 0.74);
    addKickR(R, sr, t0 + beat * 1.75, 0.62);
    addKickR(R, sr, t0 + beat * 2.5, 0.65);
    addSnareR(R, sr, t0 + beat * 1, 0.45, true);
    addSnareR(R, sr, t0 + beat * 3, 0.47, false);

    const bassHits: Array<[number, number]> = [
      [0, root],
      [0.75, root + 12],
      [1.5, root + 10],
      [1.75, root + 12],
      [2.5, root],
      [3.25, root + 7],
      [3.75, root + 10],
    ];
    bassHits.forEach(([pos, m]) => {
      addToneR(R, sr, t0 + pos * beat, beat * 0.38, midiToFreq(m), 0.36, 'bass');
    });

    [0, 1.5, 2.75].forEach((pos) => {
      const ct = t0 + pos * beat;
      [12, 15, 19, 22, 26].forEach((interval) => {
        addToneR(R, sr, ct, beat * 0.72, midiToFreq(root + interval), 0.08, 'epiano');
      });
    });

    if (grooveBar >= 8 && grooveBar < 16 && grooveBar % 2 === 1) {
      [69, 72, 74, 77, 74, 72].forEach((m, idx) => {
        addToneR(R, sr, t0 + idx * (beat * 0.5), beat * 0.4, midiToFreq(m), 0.14, 'lead');
      });
    }
  }
}

export async function synthesizeDemoWavBlobAsync(key: DemoTrackKey): Promise<Blob> {
  const { canonical, buffer, L, R, sr, beat, bar, totalBars, length } =
    buildDemoBufferSkeleton(key);
  const yieldFrame = () => new Promise<void>((r) => window.setTimeout(r, 0));

  for (let b = 0; b < totalBars; b++) {
    renderDemoBar(canonical, b, L, R, sr, beat, bar);
    if (b % 4 === 3) {
      await yieldFrame();
    }
  }

  const chunk = 441000;
  for (let i = 0; i < length; i++) {
    L[i] = Math.max(-1, Math.min(1, L[i]));
    R[i] = Math.tanh(R[i] * 0.92);
    if (i > 0 && i % chunk === 0) {
      await yieldFrame();
    }
  }

  return audioBufferToWavBlob(buffer);
}

export function createInitialDemoTracks(): PracticeTrack[] {
  const rockSpec = getSpecForKey('rock');
  const worshipSpec = getSpecForKey('worship');
  const funkSpec = getSpecForKey('funk');

  const rockBar = (60 / rockSpec.bpm) * 4;
  const worshipBar = (60 / worshipSpec.bpm) * 4;
  const funkBar = (60 / funkSpec.bpm) * 4;

  return [
    {
      id: 'demo-rock-em',
      title: 'Demo 01 - Pop Rock Arena (Em)',
      artist: 'Demo V/S · L: Click · R: Música',
      duration: Number((LEAD_OFFSET_SEC + rockSpec.totalBars * rockBar + 0.3).toFixed(2)),
      source: 'builtin',
      builtinKey: 'rock',
      preset: {
        speed: 1,
        pitchSemitones: 0,
        pitchCents: 0,
        volumeL: 1,
        volumeR: 1,
        bpm: rockSpec.bpm,
        beatsPerBar: 4,
        beatOffset: LEAD_OFFSET_SEC,
        loopA: null,
        loopB: null,
        loopEnabled: false,
        lastPosition: 0,
      },
      sections: [],
      lyricsRaw: '',
      notes: 'Referência V/S Estéreo: Canal L = Click constante (4 tempos de entrada) · Canal R = Base Pop Rock em Mi menor.',
      createdAt: 1,
    },
    {
      id: 'demo-worship-g',
      title: 'Demo 02 - Worship Atmosfera (G)',
      artist: 'Demo V/S · L: Click · R: Música',
      duration: Number((LEAD_OFFSET_SEC + worshipSpec.totalBars * worshipBar + 0.3).toFixed(2)),
      source: 'builtin',
      builtinKey: 'worship',
      preset: {
        speed: 1,
        pitchSemitones: 0,
        pitchCents: 0,
        volumeL: 1,
        volumeR: 1,
        bpm: worshipSpec.bpm,
        beatsPerBar: 4,
        beatOffset: LEAD_OFFSET_SEC,
        loopA: null,
        loopB: null,
        loopEnabled: false,
        lastPosition: 0,
      },
      sections: [],
      lyricsRaw: '',
      notes: 'Referência V/S Estéreo: Canal L = Click constante (4 tempos de entrada) · Canal R = Base Worship em Sol maior.',
      createdAt: 2,
    },
    {
      id: 'demo-funk-dm',
      title: 'Demo 03 - Funk Groove (Dm)',
      artist: 'Demo V/S · L: Click · R: Música',
      duration: Number((LEAD_OFFSET_SEC + funkSpec.totalBars * funkBar + 0.3).toFixed(2)),
      source: 'builtin',
      builtinKey: 'funk',
      preset: {
        speed: 1,
        pitchSemitones: 0,
        pitchCents: 0,
        volumeL: 1,
        volumeR: 1,
        bpm: funkSpec.bpm,
        beatsPerBar: 4,
        beatOffset: LEAD_OFFSET_SEC,
        loopA: null,
        loopB: null,
        loopEnabled: false,
        lastPosition: 0,
      },
      sections: [],
      lyricsRaw: '',
      notes: 'Referência V/S Estéreo: Canal L = Click constante (4 tempos de entrada) · Canal R = Groove Funk em Ré menor.',
      createdAt: 3,
    },
  ];
}

export function createInitialSetlists(): Setlist[] {
  return [
    {
      id: 'setlist-practice',
      name: 'Demo',
      description: 'Músicas de referência V/S em L/R (L: Click · R: Música)',
      trackIds: ['demo-rock-em', 'demo-worship-g', 'demo-funk-dm'],
      isCustomOrder: false,
    },
  ];
}
