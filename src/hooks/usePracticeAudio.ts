import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createPitchWorkletBlobUrl,
  extractWaveformPeaks,
  PITCH_WORKLET_NAME,
} from '../audio/audioUtils';
import { StudioSettings, TrackPreset } from '../types/studio';
import {
  createAudioContextSafe,
  decodeAudioDataSafe,
  playSilentAudioUnlock,
  resumeAudioContextSafe,
} from '../utils/platform';

interface CachedDecodedAudio {
  buffer: AudioBuffer;
  peaks: Float32Array;
  ch0: Float32Array;
  ch1: Float32Array | null;
  byteSize: number;
}

interface UsePracticeAudioParams {
  trackId: string | undefined;
  resolveBlob: (id: string) => Promise<Blob | null>;
  nextTrackId?: string | null;
  nextPreset?: TrackPreset | null;
  autoAdvance?: boolean;
  isMobile?: boolean;
  deferLoad?: boolean;
  preset: TrackPreset;
  settings: StudioSettings;
  autoPlayOnLoadRef?: React.MutableRefObject<boolean>;
  onTimeUpdatePersist?: (pos: number) => void;
  onAutoAdvancedTrack?: (nextTrackId: string) => void;
  onTrackEnded?: () => void;
}

export function usePracticeAudio({
  trackId,
  resolveBlob,
  nextTrackId = null,
  nextPreset = null,
  autoAdvance = false,
  isMobile = false,
  deferLoad = false,
  preset,
  settings,
  autoPlayOnLoadRef,
  onTimeUpdatePersist,
  onAutoAdvancedTrack,
  onTrackEnded,
}: UsePracticeAudioParams) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<Float32Array>(new Float32Array(0));
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [volume, setVolume] = useState(0.92);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const graphInitPromiseRef = useRef<Promise<AudioContext> | null>(null);
  const silentUnlockedRef = useRef<boolean>(false);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const mergerRef = useRef<ChannelMergerNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const gainLLRef = useRef<GainNode | null>(null);
  const gainLRRef = useRef<GainNode | null>(null);
  const gainRLRef = useRef<GainNode | null>(null);
  const gainRRRef = useRef<GainNode | null>(null);
  const workletUrlRef = useRef<string | null>(null);

  // Fallback BufferSource if AudioWorklet is unavailable
  const fallbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fallbackStartCtxTimeRef = useRef<number>(0);
  const fallbackOffsetSecRef = useRef<number>(0);

  // In-memory LRU cache of decoded AudioBuffers + waveform peaks + PCM channels
  const decodedCacheRef = useRef<Map<string, CachedDecodedAudio>>(new Map());
  const inflightDecodeRef = useRef<Map<string, Promise<CachedDecodedAudio | null>>>(new Map());

  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sampleRateRef = useRef<number>(48000);
  const durationRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  const pendingUiTimeRef = useRef<number | null>(null);

  // Refs to track worklet staging & latest props/callbacks without restarting audio graph
  const activeTrackIdRef = useRef<string | undefined>(trackId);
  activeTrackIdRef.current = trackId;
  const loadedWorkletIdRef = useRef<string | null>(null);
  const stagedWorkletIdRef = useRef<string | null>(null);
  const workletPromotedIdRef = useRef<string | null>(null);
  const autoAdvancePropRef = useRef<boolean>(Boolean(autoAdvance));
  autoAdvancePropRef.current = Boolean(autoAdvance);
  const nextPresetRef = useRef<TrackPreset | null>(nextPreset);
  nextPresetRef.current = nextPreset;
  const nextTrackIdRef = useRef<string | null>(nextTrackId);
  nextTrackIdRef.current = nextTrackId;
  const maxCacheSizeRef = useRef<number>(isMobile ? 10 : 18);
  maxCacheSizeRef.current = isMobile ? 10 : 18;
  const maxCacheBytesRef = useRef<number>(isMobile ? 420 * 1024 * 1024 : 900 * 1024 * 1024);
  maxCacheBytesRef.current = isMobile ? 420 * 1024 * 1024 : 900 * 1024 * 1024;
  const isMobileRef = useRef<boolean>(Boolean(isMobile));
  isMobileRef.current = Boolean(isMobile);

  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const resolveBlobRef = useRef(resolveBlob);
  resolveBlobRef.current = resolveBlob;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const isLoadingAudioRef = useRef(isLoadingAudio);
  isLoadingAudioRef.current = isLoadingAudio;
  const onTimeUpdatePersistRef = useRef(onTimeUpdatePersist);
  onTimeUpdatePersistRef.current = onTimeUpdatePersist;
  const onAutoAdvancedTrackRef = useRef(onAutoAdvancedTrack);
  onAutoAdvancedTrackRef.current = onAutoAdvancedTrack;
  const onTrackEndedRef = useRef(onTrackEnded);
  onTrackEndedRef.current = onTrackEnded;

  const stopFallbackSource = useCallback(() => {
    if (fallbackSourceRef.current) {
      try {
        fallbackSourceRef.current.onended = null;
        fallbackSourceRef.current.stop();
        fallbackSourceRef.current.disconnect();
      } catch {
        // Ignore already stopped source
      }
      fallbackSourceRef.current = null;
    }
  }, []);

  const syncWorkletParams = useCallback((p: TrackPreset) => {
    const worklet = workletNodeRef.current;
    if (!worklet) return;
    const clampedSpeed = Math.max(0.25, Math.min(2.5, p.speed));
    const totalSemitones = p.pitchSemitones + p.pitchCents / 100;
    const np = nextPresetRef.current;
    const nextSpeed = np ? Math.max(0.25, Math.min(2.5, np.speed)) : 1;
    const nextSemitones = np ? np.pitchSemitones + np.pitchCents / 100 : 0;

    worklet.port.postMessage({
      type: 'params',
      speed: clampedSpeed,
      semitones: totalSemitones,
      autoAdvance: autoAdvancePropRef.current,
      nextSpeed,
      nextSemitones,
      loopEnabled: false,
      loopASample: 0,
      loopBSample: 0,
    });
  }, []);

  const startFallbackNode = useCallback(
    (ctx: AudioContext, buffer: AudioBuffer, offsetSec: number) => {
      stopFallbackSource();
      if (!splitterRef.current) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = Math.max(0.25, Math.min(2.5, presetRef.current.speed));
      src.connect(splitterRef.current);
      fallbackSourceRef.current = src;
      fallbackStartCtxTimeRef.current = ctx.currentTime;
      fallbackOffsetSecRef.current = offsetSec;
      src.onended = () => {
        if (fallbackSourceRef.current === src) {
          fallbackSourceRef.current = null;
        }
        if (isPlayingRef.current) {
          isPlayingRef.current = false;
          setIsPlaying(false);
          currentTimeRef.current = 0;
          setCurrentTime(0);
          onTimeUpdatePersistRef.current?.(0);
          onTrackEndedRef.current?.();
        }
      };
      src.start(0, Math.max(0, Math.min(buffer.duration, offsetSec)));
    },
    [stopFallbackSource]
  );

  const ensureAudioGraph = useCallback(async (resumeContext = true) => {
    if (!graphInitPromiseRef.current) {
      graphInitPromiseRef.current = (async () => {
        const ctx = createAudioContextSafe({ latencyHint: 'playback' });
        if (!ctx) {
          throw new Error('Web Audio API unavailable in this browser');
        }
        audioCtxRef.current = ctx;

        const masterGain = ctx.createGain();
        masterGain.gain.value = volumeRef.current;
        masterGain.connect(ctx.destination);
        gainNodeRef.current = masterGain;

        // Clickless 2x2 routing matrix for independent L/R levels and instant L/R swap (Y-cable P2 -> 2x P10 mono)
        const splitter = ctx.createChannelSplitter(2);
        const gainLL = ctx.createGain();
        const gainLR = ctx.createGain();
        const gainRL = ctx.createGain();
        const gainRR = ctx.createGain();
        const merger = ctx.createChannelMerger(2);

        const initVL = Math.max(0, Math.min(1.5, presetRef.current.volumeL ?? 1));
        const initVR = Math.max(0, Math.min(1.5, presetRef.current.volumeR ?? 1));
        const initialSwap = Boolean(settingsRef.current.swapLR);

        gainLL.gain.value = initialSwap ? 0 : initVL;
        gainLR.gain.value = initialSwap ? initVL : 0;
        gainRL.gain.value = initialSwap ? initVR : 0;
        gainRR.gain.value = initialSwap ? 0 : initVR;

        splitterRef.current = splitter;
        mergerRef.current = merger;
        gainLLRef.current = gainLL;
        gainLRRef.current = gainLR;
        gainRLRef.current = gainRL;
        gainRRRef.current = gainRR;

        splitter.connect(gainLL, 0);
        gainLL.connect(merger, 0, 0);
        splitter.connect(gainLR, 0);
        gainLR.connect(merger, 0, 1);
        splitter.connect(gainRL, 1);
        gainRL.connect(merger, 0, 0);
        splitter.connect(gainRR, 1);
        gainRR.connect(merger, 0, 1);
        merger.connect(masterGain);

        if (ctx.audioWorklet) {
          const wUrl = createPitchWorkletBlobUrl();
          workletUrlRef.current = wUrl;
          try {
            await ctx.audioWorklet.addModule(wUrl);
            const worklet = new AudioWorkletNode(ctx, PITCH_WORKLET_NAME, {
              numberOfInputs: 0,
              numberOfOutputs: 1,
              outputChannelCount: [2],
            });

            worklet.port.onmessage = (ev) => {
              const msg = ev.data;
              if (!msg) return;
              if (msg.type === 'pos') {
                const sec = Math.max(
                  0,
                  Math.min(durationRef.current || 0, msg.sample / (sampleRateRef.current || 48000))
                );
                currentTimeRef.current = sec;
                pendingUiTimeRef.current = sec;
              } else if (msg.type === 'autoAdvanced') {
                const promotedId = typeof msg.nextId === 'string' ? msg.nextId : '';
                if (!promotedId) return;
                workletPromotedIdRef.current = promotedId;
                loadedWorkletIdRef.current = promotedId;
                stagedWorkletIdRef.current = null;

                const promotedEntry = decodedCacheRef.current.get(promotedId);
                if (promotedEntry) {
                  audioBufferRef.current = promotedEntry.buffer;
                  sampleRateRef.current = promotedEntry.buffer.sampleRate;
                  durationRef.current = promotedEntry.buffer.duration;
                }
                currentTimeRef.current = 0;
                pendingUiTimeRef.current = 0;
                isPlayingRef.current = true;
                setIsPlaying(true);
                setCurrentTime(0);
                onAutoAdvancedTrackRef.current?.(promotedId);
              } else if (msg.type === 'ended') {
                isPlayingRef.current = false;
                setIsPlaying(false);
                currentTimeRef.current = 0;
                pendingUiTimeRef.current = null;
                setCurrentTime(0);
                onTimeUpdatePersistRef.current?.(0);
                onTrackEndedRef.current?.();
              }
            };

            workletNodeRef.current = worklet;
            worklet.connect(splitter);
          } catch (err) {
            console.warn('AudioWorklet unavailable, using fallback AudioBufferSource:', err);
          } finally {
            URL.revokeObjectURL(wUrl);
            if (workletUrlRef.current === wUrl) {
              workletUrlRef.current = null;
            }
          }
        }
        return ctx;
      })().catch((err) => {
        graphInitPromiseRef.current = null;
        throw err;
      });
    }

    const ctx = await graphInitPromiseRef.current;
    if (resumeContext) {
      resumeAudioContextSafe(ctx).catch(() => {});
      if (!silentUnlockedRef.current) {
        silentUnlockedRef.current = true;
        playSilentAudioUnlock(ctx);
      }
    }
    return ctx;
  }, []);

  const cacheDecodedEntry = useCallback((id: string, entry: CachedDecodedAudio) => {
    const cache = decodedCacheRef.current;
    const limit = maxCacheSizeRef.current;
    const byteBudget = maxCacheBytesRef.current;

    if (cache.has(id)) {
      cache.delete(id);
    }
    cache.set(id, entry);

    let totalBytes = 0;
    cache.forEach((v) => {
      totalBytes += v.byteSize;
    });

    if (cache.size <= limit && totalBytes <= byteBudget) {
      return;
    }

    const protectedIds = new Set<string>([id]);
    if (activeTrackIdRef.current) protectedIds.add(activeTrackIdRef.current);
    if (nextTrackIdRef.current) protectedIds.add(nextTrackIdRef.current);
    if (stagedWorkletIdRef.current) protectedIds.add(stagedWorkletIdRef.current);

    for (const key of Array.from(cache.keys())) {
      if (cache.size <= limit && (cache.size <= 3 || totalBytes <= byteBudget)) break;
      if (protectedIds.has(key)) continue;
      const removed = cache.get(key);
      if (removed) totalBytes -= removed.byteSize;
      cache.delete(key);
    }
  }, []);

  const getOrDecodeTrack = useCallback(
    async (id: string, ctx: AudioContext): Promise<CachedDecodedAudio | null> => {
      const cache = decodedCacheRef.current;
      const existing = cache.get(id);
      if (existing) {
        cache.delete(id);
        cache.set(id, existing);
        return existing;
      }

      const inflight = inflightDecodeRef.current.get(id);
      if (inflight) {
        return inflight;
      }

      const promise = (async (): Promise<CachedDecodedAudio | null> => {
        try {
          const blob = await resolveBlobRef.current(id);
          if (!blob) return null;
          const arrBuf = await blob.arrayBuffer();
          const decoded = await decodeAudioDataSafe(ctx, arrBuf);
          const ch0 = decoded.getChannelData(0);
          const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null;
          const extractedPeaks = extractWaveformPeaks(decoded, 640);
          const entry: CachedDecodedAudio = {
            buffer: decoded,
            peaks: extractedPeaks,
            ch0,
            ch1,
            byteSize: ch0.byteLength + (ch1 ? ch1.byteLength : 0),
          };
          cacheDecodedEntry(id, entry);
          return entry;
        } catch (err) {
          console.error('Failed to decode audio:', err);
          return null;
        } finally {
          inflightDecodeRef.current.delete(id);
        }
      })();

      inflightDecodeRef.current.set(id, promise);
      return promise;
    },
    [cacheDecodedEntry]
  );

  const prewarmTrack = useCallback(
    (id: string) => {
      if (!id || decodedCacheRef.current.has(id) || inflightDecodeRef.current.has(id)) {
        return;
      }
      ensureAudioGraph(false)
        .then((ctx) => {
          if (decodedCacheRef.current.has(id) || inflightDecodeRef.current.has(id)) return;
          return getOrDecodeTrack(id, ctx);
        })
        .catch(() => {});
    },
    [ensureAudioGraph, getOrDecodeTrack]
  );

  const prefetchTracks = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return () => {};
      let cancelled = false;
      const waitForIdle = () =>
        new Promise<void>((resolve) => {
          const ric = (window as unknown as {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
          }).requestIdleCallback;
          if (typeof ric === 'function') {
            ric(() => resolve(), { timeout: 120 });
          } else {
            window.setTimeout(resolve, 20);
          }
        });
      const run = async () => {
        const ctx = audioCtxRef.current ?? (await ensureAudioGraph(false));
        if (cancelled || !ctx) return;
        for (const id of ids) {
          if (cancelled || !id) break;
          while (
            !cancelled &&
            (isLoadingAudioRef.current || (isPlayingRef.current && currentTimeRef.current < 0.6))
          ) {
            await new Promise<void>((r) => window.setTimeout(r, 150));
          }
          if (cancelled) break;
          if (decodedCacheRef.current.has(id) || inflightDecodeRef.current.has(id)) continue;
          await getOrDecodeTrack(id, ctx);
          if (cancelled) break;
          await waitForIdle();
        }
      };
      run().catch(() => {});
      return () => {
        cancelled = true;
      };
    },
    [ensureAudioGraph, getOrDecodeTrack]
  );

  const evictTrackCache = useCallback((id: string) => {
    decodedCacheRef.current.delete(id);
    if (stagedWorkletIdRef.current === id) {
      stagedWorkletIdRef.current = null;
      workletNodeRef.current?.port.postMessage({ type: 'clearStaged' });
    }
  }, []);

  const unlockAudio = useCallback(() => {
    ensureAudioGraph()
      .then((ctx) => {
        if (!silentUnlockedRef.current) {
          silentUnlockedRef.current = true;
          playSilentAudioUnlock(ctx);
        }
      })
      .catch(() => {});
  }, [ensureAudioGraph]);

  // Recover iOS/iPadOS/Android AudioContext automatically after background/call/Siri interruption
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleRecoverAudio = () => {
      const ctx = audioCtxRef.current;
      if (!ctx || !isPlayingRef.current) return;
      if (ctx.state !== 'running') {
        resumeAudioContextSafe(ctx).catch(() => {});
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleRecoverAudio();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', handleRecoverAudio);
    window.addEventListener('pageshow', handleRecoverAudio);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', handleRecoverAudio);
      window.removeEventListener('pageshow', handleRecoverAudio);
    };
  }, []);

  // Load & decode AudioBuffer (synchronous instant load on cache hit) whenever trackId changes
  useEffect(() => {
    if (deferLoad && trackId) {
      return;
    }
    let cancelled = false;
    const existingCtx = audioCtxRef.current;
    const cachedEntry = existingCtx && trackId ? decodedCacheRef.current.get(trackId) : undefined;

    // Fast-path A: Worklet already auto-advanced seamlessly into this track at sample 0
    if (trackId && workletPromotedIdRef.current === trackId) {
      workletPromotedIdRef.current = null;
      stopFallbackSource();
      if (cachedEntry) {
        decodedCacheRef.current.delete(trackId);
        decodedCacheRef.current.set(trackId, cachedEntry);
        audioBufferRef.current = cachedEntry.buffer;
        sampleRateRef.current = cachedEntry.buffer.sampleRate;
        durationRef.current = cachedEntry.buffer.duration;
        setAudioBuffer(cachedEntry.buffer);
        setDuration(cachedEntry.buffer.duration);
        setPeaks(cachedEntry.peaks);
        setIsLoadingAudio(false);
        currentTimeRef.current = 0;
        pendingUiTimeRef.current = null;
        setCurrentTime(0);
        isPlayingRef.current = true;
        setIsPlaying(true);
        syncWorkletParams(presetRef.current);
        return () => {
          cancelled = true;
        };
      }
      // Recover UI metadata cleanly without pausing the already-playing promoted worklet track
      if (existingCtx) {
        setIsLoadingAudio(true);
        getOrDecodeTrack(trackId, existingCtx)
          .then((entry) => {
            if (cancelled || !entry) return;
            audioBufferRef.current = entry.buffer;
            sampleRateRef.current = entry.buffer.sampleRate;
            durationRef.current = entry.buffer.duration;
            setAudioBuffer(entry.buffer);
            setDuration(entry.buffer.duration);
            setPeaks(entry.peaks);
            syncWorkletParams(presetRef.current);
          })
          .finally(() => {
            if (!cancelled) setIsLoadingAudio(false);
          });
        return () => {
          cancelled = true;
        };
      }
    }

    stopFallbackSource();

    if (!trackId) {
      workletPromotedIdRef.current = null;
      loadedWorkletIdRef.current = null;
      stagedWorkletIdRef.current = null;
      isPlayingRef.current = false;
      setIsPlaying(false);
      if (workletNodeRef.current) {
        workletNodeRef.current.port.postMessage({ type: 'pause', seekSample: 0 });
        workletNodeRef.current.port.postMessage({ type: 'clearStaged' });
      }
      setIsLoadingAudio(false);
      setPeaks(new Float32Array(0));
      setAudioBuffer(null);
      audioBufferRef.current = null;
      durationRef.current = 0;
      currentTimeRef.current = 0;
      setDuration(0);
      setCurrentTime(0);
      return;
    }

    // Fast-path B: Manual track switch to the pre-staged next track (zero array copy)
    const isStagedHit = Boolean(
      workletNodeRef.current &&
        existingCtx &&
        cachedEntry &&
        stagedWorkletIdRef.current === trackId
    );
    const shouldAutoPlayStaged = Boolean(autoPlayOnLoadRef?.current);
    if (isStagedHit && cachedEntry && shouldAutoPlayStaged && workletNodeRef.current && existingCtx) {
      if (autoPlayOnLoadRef) {
        autoPlayOnLoadRef.current = false;
      }
      stagedWorkletIdRef.current = null;
      decodedCacheRef.current.delete(trackId);
      decodedCacheRef.current.set(trackId, cachedEntry);

      audioBufferRef.current = cachedEntry.buffer;
      sampleRateRef.current = cachedEntry.buffer.sampleRate;
      durationRef.current = cachedEntry.buffer.duration;
      setAudioBuffer(cachedEntry.buffer);
      setDuration(cachedEntry.buffer.duration);
      setPeaks(cachedEntry.peaks);
      setIsLoadingAudio(false);
      currentTimeRef.current = 0;
      pendingUiTimeRef.current = null;
      setCurrentTime(0);

      if (existingCtx.state !== 'running') {
        resumeAudioContextSafe(existingCtx).catch(() => {});
      }
      const p = presetRef.current;
      workletNodeRef.current.port.postMessage({
        type: 'playStaged',
        id: trackId,
        fromSample: 0,
        speed: Math.max(0.25, Math.min(2.5, p.speed)),
        semitones: p.pitchSemitones + p.pitchCents / 100,
      });
      syncWorkletParams(p);
      loadedWorkletIdRef.current = trackId;
      isPlayingRef.current = true;
      setIsPlaying(true);
      return () => {
        cancelled = true;
      };
    }

    const applyLoadedEntry = (ctx: AudioContext, entry: CachedDecodedAudio) => {
      const { buffer: decoded, peaks: nextPeaks, ch0, ch1 } = entry;
      audioBufferRef.current = decoded;
      sampleRateRef.current = decoded.sampleRate;
      durationRef.current = decoded.duration;

      const shouldAutoPlay = Boolean(autoPlayOnLoadRef?.current);
      if (shouldAutoPlay && autoPlayOnLoadRef) {
        autoPlayOnLoadRef.current = false;
      }

      const startPos = shouldAutoPlay
        ? 0
        : Math.min(presetRef.current.lastPosition || 0, Math.max(0, decoded.duration - 0.1));
      currentTimeRef.current = startPos;
      pendingUiTimeRef.current = null;

      if (stagedWorkletIdRef.current === trackId) {
        stagedWorkletIdRef.current = null;
      }

      // Dispatch audio engine start FIRST before React UI state updates for lowest click-to-sound latency
      if (workletNodeRef.current) {
        const ch0Copy = ch0.slice();
        const ch1Copy = ch1 ? ch1.slice() : null;
        const transfer: Transferable[] = ch1Copy ? [ch0Copy.buffer, ch1Copy.buffer] : [ch0Copy.buffer];

        workletNodeRef.current.port.postMessage(
          {
            type: 'load',
            id: trackId,
            ch0: ch0Copy,
            ch1: ch1Copy,
            sampleRate: decoded.sampleRate,
            startSample: Math.round(startPos * decoded.sampleRate),
          },
          transfer
        );
        loadedWorkletIdRef.current = trackId;
        syncWorkletParams(presetRef.current);

        if (shouldAutoPlay) {
          if (ctx.state !== 'running') {
            resumeAudioContextSafe(ctx).catch(() => {});
          }
          workletNodeRef.current.port.postMessage({ type: 'play', fromSample: 0 });
          isPlayingRef.current = true;
          setIsPlaying(true);
        } else {
          isPlayingRef.current = false;
          setIsPlaying(false);
        }
      } else if (shouldAutoPlay) {
        if (ctx.state !== 'running') {
          resumeAudioContextSafe(ctx).catch(() => {});
        }
        startFallbackNode(ctx, decoded, startPos);
        isPlayingRef.current = true;
        setIsPlaying(true);
      } else {
        isPlayingRef.current = false;
        setIsPlaying(false);
      }

      setAudioBuffer(decoded);
      setDuration(decoded.duration);
      setPeaks(nextPeaks);
      setCurrentTime(startPos);
    };

    if (existingCtx && cachedEntry) {
      decodedCacheRef.current.delete(trackId);
      decodedCacheRef.current.set(trackId, cachedEntry);
      setIsLoadingAudio(false);
      applyLoadedEntry(existingCtx, cachedEntry);
      return () => {
        cancelled = true;
      };
    }

    isPlayingRef.current = false;
    setIsPlaying(false);
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: 'pause', seekSample: 0 });
    }

    const load = async () => {
      setIsLoadingAudio(true);
      try {
        const ctx = await ensureAudioGraph(false);
        if (cancelled) return;

        const entry = await getOrDecodeTrack(trackId, ctx);
        if (cancelled) return;
        if (!entry) {
          if (autoPlayOnLoadRef) autoPlayOnLoadRef.current = false;
          return;
        }

        applyLoadedEntry(ctx, entry);
      } catch (err) {
        if (autoPlayOnLoadRef) autoPlayOnLoadRef.current = false;
        console.error('Failed to load audio track:', err);
      } finally {
        if (!cancelled) setIsLoadingAudio(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [
    trackId,
    deferLoad,
    autoPlayOnLoadRef,
    ensureAudioGraph,
    getOrDecodeTrack,
    startFallbackNode,
    stopFallbackSource,
    syncWorkletParams,
  ]);

  // Background pre-decode + worklet staging for instant Auto-Advance AND instant Manual Next
  useEffect(() => {
    if (deferLoad || !trackId || isLoadingAudio) return;

    if (!nextTrackId || nextTrackId === trackId) {
      if (workletNodeRef.current && stagedWorkletIdRef.current) {
        workletNodeRef.current.port.postMessage({ type: 'clearStaged' });
        stagedWorkletIdRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const timerId = window.setTimeout(async () => {
      try {
        const ctx = audioCtxRef.current ?? (await ensureAudioGraph(false));
        if (!ctx || cancelled || activeTrackIdRef.current !== trackId) return;

        const nextEntry = await getOrDecodeTrack(nextTrackId, ctx);
        if (cancelled || !nextEntry || activeTrackIdRef.current !== trackId) return;

        const worklet = workletNodeRef.current;
        if (worklet && stagedWorkletIdRef.current !== nextTrackId) {
          const ch0Copy = nextEntry.ch0.slice();
          const ch1Copy = nextEntry.ch1 ? nextEntry.ch1.slice() : null;
          const transfer: Transferable[] = ch1Copy ? [ch0Copy.buffer, ch1Copy.buffer] : [ch0Copy.buffer];
          const np = nextPresetRef.current;

          worklet.port.postMessage(
            {
              type: 'stageNext',
              id: nextTrackId,
              ch0: ch0Copy,
              ch1: ch1Copy,
              sampleRate: nextEntry.buffer.sampleRate,
              speed: np ? Math.max(0.25, Math.min(2.5, np.speed)) : 1,
              semitones: np ? np.pitchSemitones + np.pitchCents / 100 : 0,
            },
            transfer
          );
          stagedWorkletIdRef.current = nextTrackId;
          syncWorkletParams(presetRef.current);
        }
      } catch {
        // Ignore background staging failures (playback continues unaffected)
      }
    }, 40);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [deferLoad, trackId, isLoadingAudio, nextTrackId, ensureAudioGraph, getOrDecodeTrack, syncWorkletParams]);

  // Real-time speed, pitch, auto-advance, and next-track preset sync
  useEffect(() => {
    syncWorkletParams(preset);
    if (fallbackSourceRef.current) {
      fallbackSourceRef.current.playbackRate.value = Math.max(0.25, Math.min(2.5, preset.speed));
    }
  }, [
    preset.speed,
    preset.pitchSemitones,
    preset.pitchCents,
    autoAdvance,
    nextPreset?.speed,
    nextPreset?.pitchSemitones,
    nextPreset?.pitchCents,
    syncWorkletParams,
  ]);

  // Real-time master, L/R levels, and clickless L/R channel swap via smooth gain ramps
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (gainNodeRef.current) {
      const master = Math.max(0, Math.min(1.5, volume));
      gainNodeRef.current.gain.setTargetAtTime(master, now, 0.012);
    }

    const vL = Math.max(0, Math.min(1.5, preset.volumeL ?? 1));
    const vR = Math.max(0, Math.min(1.5, preset.volumeR ?? 1));
    const swap = Boolean(settings.swapLR);

    if (gainLLRef.current) {
      gainLLRef.current.gain.setTargetAtTime(swap ? 0 : vL, now, 0.012);
    }
    if (gainLRRef.current) {
      gainLRRef.current.gain.setTargetAtTime(swap ? vL : 0, now, 0.012);
    }
    if (gainRLRef.current) {
      gainRLRef.current.gain.setTargetAtTime(swap ? vR : 0, now, 0.012);
    }
    if (gainRRRef.current) {
      gainRRRef.current.gain.setTargetAtTime(swap ? 0 : vR, now, 0.012);
    }
  }, [volume, preset.volumeL, preset.volumeR, settings.swapLR]);

  const seekTo = useCallback(
    (sec: number) => {
      const dur = durationRef.current || 0;
      const target = Math.max(0, Math.min(dur, sec));
      currentTimeRef.current = target;
      pendingUiTimeRef.current = null;
      setCurrentTime(target);

      if (workletNodeRef.current) {
        workletNodeRef.current.port.postMessage({
          type: 'seek',
          sample: Math.round(target * (sampleRateRef.current || 48000)),
        });
      } else if (isPlayingRef.current && audioCtxRef.current && audioBufferRef.current) {
        startFallbackNode(audioCtxRef.current, audioBufferRef.current, target);
      }

      onTimeUpdatePersistRef.current?.(target);
    },
    [startFallbackNode]
  );

  const play = useCallback(
    async (_unusedCountInBars?: number, startAtSec?: number) => {
      const targetTrackId = activeTrackIdRef.current;
      const existingCtx = audioCtxRef.current;
      const readyWorklet = workletNodeRef.current;

      // Zero-latency synchronous play dispatch when current track is already loaded in the worklet
      if (
        existingCtx &&
        readyWorklet &&
        targetTrackId &&
        loadedWorkletIdRef.current === targetTrackId
      ) {
        if (existingCtx.state !== 'running') {
          resumeAudioContextSafe(existingCtx).catch(() => {});
        }
        if (!silentUnlockedRef.current) {
          silentUnlockedRef.current = true;
          playSilentAudioUnlock(existingCtx);
        }
        const dur = durationRef.current || 0;
        const targetPos =
          typeof startAtSec === 'number'
            ? Math.max(0, Math.min(dur, startAtSec))
            : currentTimeRef.current;
        currentTimeRef.current = targetPos;
        pendingUiTimeRef.current = null;
        setCurrentTime(targetPos);

        syncWorkletParams(presetRef.current);
        readyWorklet.port.postMessage({
          type: 'play',
          fromSample: Math.round(targetPos * (sampleRateRef.current || 48000)),
        });
        isPlayingRef.current = true;
        setIsPlaying(true);
        return;
      }

      try {
        const ctx = await ensureAudioGraph(true);
        if (ctx.state !== 'running') {
          resumeAudioContextSafe(ctx).catch(() => {});
        }

        if (
          targetTrackId &&
          (!audioBufferRef.current ||
            (workletNodeRef.current && loadedWorkletIdRef.current !== targetTrackId))
        ) {
          const entry = await getOrDecodeTrack(targetTrackId, ctx);
          if (!entry || activeTrackIdRef.current !== targetTrackId) return;
          audioBufferRef.current = entry.buffer;
          sampleRateRef.current = entry.buffer.sampleRate;
          durationRef.current = entry.buffer.duration;
          setAudioBuffer(entry.buffer);
          setDuration(entry.buffer.duration);
          setPeaks(entry.peaks);
          if (workletNodeRef.current && loadedWorkletIdRef.current !== targetTrackId) {
            const ch0Copy = entry.ch0.slice();
            const ch1Copy = entry.ch1 ? entry.ch1.slice() : null;
            const transfer: Transferable[] = ch1Copy
              ? [ch0Copy.buffer, ch1Copy.buffer]
              : [ch0Copy.buffer];
            const initPos =
              typeof startAtSec === 'number'
                ? Math.max(0, Math.min(entry.buffer.duration, startAtSec))
                : Math.min(presetRef.current.lastPosition || 0, Math.max(0, entry.buffer.duration - 0.1));
            currentTimeRef.current = initPos;
            workletNodeRef.current.port.postMessage(
              {
                type: 'load',
                id: targetTrackId,
                ch0: ch0Copy,
                ch1: ch1Copy,
                sampleRate: entry.buffer.sampleRate,
                startSample: Math.round(initPos * entry.buffer.sampleRate),
              },
              transfer
            );
            loadedWorkletIdRef.current = targetTrackId;
          }
        }

        const dur = durationRef.current || 0;
        const targetPos =
          typeof startAtSec === 'number'
            ? Math.max(0, Math.min(dur, startAtSec))
            : currentTimeRef.current;

        currentTimeRef.current = targetPos;
        pendingUiTimeRef.current = null;
        setCurrentTime(targetPos);

        if (workletNodeRef.current) {
          syncWorkletParams(presetRef.current);
          workletNodeRef.current.port.postMessage({
            type: 'play',
            fromSample: Math.round(targetPos * (sampleRateRef.current || 48000)),
          });
        } else if (audioBufferRef.current && splitterRef.current) {
          startFallbackNode(ctx, audioBufferRef.current, targetPos);
        }

        isPlayingRef.current = true;
        setIsPlaying(true);
      } catch (err) {
        console.error('Failed to start audio playback:', err);
        isPlayingRef.current = false;
        setIsPlaying(false);
      }
    },
    [ensureAudioGraph, getOrDecodeTrack, startFallbackNode, syncWorkletParams]
  );

  const pause = useCallback(() => {
    if (autoPlayOnLoadRef) {
      autoPlayOnLoadRef.current = false;
    }
    stopFallbackSource();
    isPlayingRef.current = false;
    setIsPlaying(false);

    const nextPos = currentTimeRef.current;
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({
        type: 'pause',
        seekSample: Math.round(nextPos * (sampleRateRef.current || 48000)),
      });
    }

    pendingUiTimeRef.current = null;
    setCurrentTime(nextPos);
    onTimeUpdatePersistRef.current?.(nextPos);
  }, [autoPlayOnLoadRef, stopFallbackSource]);

  const stop = useCallback(() => {
    if (autoPlayOnLoadRef) {
      autoPlayOnLoadRef.current = false;
    }
    stopFallbackSource();
    isPlayingRef.current = false;
    setIsPlaying(false);

    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({
        type: 'pause',
        seekSample: 0,
      });
    }

    currentTimeRef.current = 0;
    pendingUiTimeRef.current = null;
    setCurrentTime(0);
    onTimeUpdatePersistRef.current?.(0);
  }, [autoPlayOnLoadRef, stopFallbackSource]);

  // Throttled ~25fps UI playhead timer while actively playing
  useEffect(() => {
    if (!isPlaying) return;

    let rafId: number;
    let lastUiSync = 0;
    const uiIntervalMs = isMobileRef.current ? 52 : 44;
    const tick = (now: number) => {
      const shouldSyncUi = now - lastUiSync >= uiIntervalMs;
      if (workletNodeRef.current) {
        if (pendingUiTimeRef.current !== null && shouldSyncUi) {
          lastUiSync = now;
          setCurrentTime(pendingUiTimeRef.current);
          pendingUiTimeRef.current = null;
        }
      } else if (audioCtxRef.current && fallbackSourceRef.current) {
        const elapsed =
          (audioCtxRef.current.currentTime - fallbackStartCtxTimeRef.current) *
          Math.max(0.25, presetRef.current.speed);
        const nowPos = Math.min(durationRef.current || 0, fallbackOffsetSecRef.current + elapsed);
        currentTimeRef.current = nowPos;
        if (shouldSyncUi) {
          lastUiSync = now;
          setCurrentTime(nowPos);
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopFallbackSource();
      decodedCacheRef.current.clear();
      inflightDecodeRef.current.clear();
      graphInitPromiseRef.current = null;

      const worklet = workletNodeRef.current;
      if (worklet) {
        worklet.port.onmessage = null;
        try {
          worklet.disconnect();
        } catch {
          // ignore disconnect errors during teardown
        }
        workletNodeRef.current = null;
      }

      const nodesToDisconnect: Array<AudioNode | null> = [
        splitterRef.current,
        gainLLRef.current,
        gainLRRef.current,
        gainRLRef.current,
        gainRRRef.current,
        mergerRef.current,
        gainNodeRef.current,
      ];
      for (const node of nodesToDisconnect) {
        if (!node) continue;
        try {
          node.disconnect();
        } catch {
          // ignore disconnect errors during teardown
        }
      }
      splitterRef.current = null;
      gainLLRef.current = null;
      gainLRRef.current = null;
      gainRLRef.current = null;
      gainRRRef.current = null;
      mergerRef.current = null;
      gainNodeRef.current = null;

      if (workletUrlRef.current) {
        URL.revokeObjectURL(workletUrlRef.current);
        workletUrlRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, [stopFallbackSource]);

  return useMemo(
    () => ({
      isPlaying,
      isLoadingAudio,
      currentTime,
      duration,
      peaks,
      audioBuffer,
      setVolume,
      play,
      pause,
      stop,
      seekTo,
      unlockAudio,
      prewarmTrack,
      prefetchTracks,
      evictTrackCache,
    }),
    [
      isPlaying,
      isLoadingAudio,
      currentTime,
      duration,
      peaks,
      audioBuffer,
      play,
      pause,
      stop,
      seekTo,
      unlockAudio,
      prewarmTrack,
      prefetchTracks,
      evictTrackCache,
    ]
  );
}
