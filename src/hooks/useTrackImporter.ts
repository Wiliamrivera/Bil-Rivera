import React, { useCallback, useEffect, useRef, useState } from 'react';
import { detectBpmAndOffset } from '../audio/audioUtils';
import {
  saveActiveIds,
  saveAudioBlobToDB,
  saveAudioBlobsBatchToDB,
} from '../storage/studioStorage';
import { PracticeTrack, Setlist } from '../types/studio';
import {
  filterPlayableAudioFiles,
  inferAudioMimeType,
  materializeAudioBlob,
} from '../utils/audioFileFilter';
import { createAudioContextSafe, decodeAudioDataSafe } from '../utils/platform';
import {
  compareTrackTitles,
  createLocalTrack,
  createTrackId,
  readAudioDurationFast,
  sortTrackIdsByTitle,
  stripFileExtension,
} from '../utils/trackUtils';

export interface ImportStatusState {
  current: number;
  total: number;
  fileName: string;
}

interface UseTrackImporterOptions {
  tracksRef: React.MutableRefObject<PracticeTrack[]>;
  activeSetlistIdRef: React.MutableRefObject<string>;
  blobCacheRef: React.MutableRefObject<Map<string, Blob>>;
  maxBlobCache: number;
  allTracksCustomOrderRef: React.MutableRefObject<boolean>;
  setTracks: React.Dispatch<React.SetStateAction<PracticeTrack[]>>;
  setSetlists: React.Dispatch<React.SetStateAction<Setlist[]>>;
  setActiveTrackId: React.Dispatch<React.SetStateAction<string>>;
  onImportedFocusStudio: () => void;
  preparingLabel: string;
  emptyErrorLabel: string;
  storageErrorLabel: string;
}

export function useTrackImporter({
  tracksRef,
  activeSetlistIdRef,
  blobCacheRef,
  maxBlobCache,
  allTracksCustomOrderRef,
  setTracks,
  setSetlists,
  setActiveTrackId,
  onImportedFocusStudio,
  preparingLabel,
  emptyErrorLabel,
  storageErrorLabel,
}: UseTrackImporterOptions) {
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<ImportStatusState | null>(null);
  const [importSuccessCount, setImportSuccessCount] = useState<number | null>(null);
  const [importErrorNotice, setImportErrorNotice] = useState<string | null>(null);

  const importSuccessTimerRef = useRef<number | null>(null);
  const importErrorTimerRef = useRef<number | null>(null);
  const importRunningRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      if (importSuccessTimerRef.current !== null) {
        window.clearTimeout(importSuccessTimerRef.current);
      }
      if (importErrorTimerRef.current !== null) {
        window.clearTimeout(importErrorTimerRef.current);
      }
    };
  }, []);

  const clearFeedbackTimers = useCallback(() => {
    if (importSuccessTimerRef.current !== null) {
      window.clearTimeout(importSuccessTimerRef.current);
      importSuccessTimerRef.current = null;
    }
    if (importErrorTimerRef.current !== null) {
      window.clearTimeout(importErrorTimerRef.current);
      importErrorTimerRef.current = null;
    }
  }, []);

  const showImportError = useCallback(
    (message: string) => {
      if (importErrorTimerRef.current !== null) {
        window.clearTimeout(importErrorTimerRef.current);
      }
      setImportErrorNotice(message);
      importErrorTimerRef.current = window.setTimeout(() => {
        setImportErrorNotice(null);
        importErrorTimerRef.current = null;
      }, 4500);
    },
    []
  );

  const handlePreparingImport = useCallback(
    (count?: number) => {
      clearFeedbackTimers();
      setImportSuccessCount(null);
      setImportErrorNotice(null);
      setIsImporting(true);
      setImportStatus({
        current: 0,
        total: count || 0,
        fileName: preparingLabel,
      });
    },
    [clearFeedbackTimers, preparingLabel]
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
        showImportError(emptyErrorLabel);
        return;
      }

      clearFeedbackTimers();
      setImportSuccessCount(null);
      setImportErrorNotice(null);
      setIsImporting(true);
      setImportStatus({
        current: 1,
        total: audioFiles.length,
        fileName: stripFileExtension(audioFiles[0].name),
      });

      const targetSetlistId = activeSetlistIdRef.current;
      const useLightMetadata = audioFiles.length > 5;
      const ctx = !useLightMetadata ? createAudioContextSafe() : null;

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
            } catch {
              storageWriteFailures += 1;
            }
          }
        }

        const persistedTracks = tracksToCommit.filter((tr) => savedIds.has(tr.id));
        if (persistedTracks.length === 0) return;

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
            setImportStatus({
              current: Math.min(i + slice.length, audioFiles.length),
              total: audioFiles.length,
              fileName: stripFileExtension(slice[0].name),
            });
            await new Promise<void>((r) => window.setTimeout(r, 0));

            const [durations, blobs] = await Promise.all([
              Promise.all(slice.map((file) => readAudioDurationFast(file, 650).catch(() => 0))),
              Promise.all(slice.map((file) => materializeAudioBlob(file))),
            ]);
            const nowBase = Date.now();
            for (let j = 0; j < slice.length; j++) {
              const file = slice[j];
              const idx = i + j;
              const id = createTrackId(idx);
              pendingBlobs.push({ id, blob: blobs[j] });
              pendingTracks.push(
                createLocalTrack({
                  id,
                  title: stripFileExtension(file.name, `Track ${idx + 1}`),
                  duration: durations[j] || 0,
                  mimeType: inferAudioMimeType(file.name, file.type),
                  createdAt: nowBase + idx,
                })
              );
            }

            if (pendingTracks.length >= BATCH_SIZE) {
              await flushChunk();
            }
          }
        } else {
          for (let i = 0; i < audioFiles.length; i++) {
            const file = audioFiles[i];
            const cleanTitle = stripFileExtension(file.name, `Track ${i + 1}`);
            setImportStatus({
              current: i + 1,
              total: audioFiles.length,
              fileName: cleanTitle,
            });
            await new Promise<void>((r) => window.setTimeout(r, 0));

            try {
              const id = createTrackId(i);
              const mimeType = inferAudioMimeType(file.name, file.type);
              let duration = 0;
              let bpm = 120;
              let beatOffset = 0;

              let rawArrBuf: ArrayBuffer | null = null;
              let standaloneBlob: Blob;
              try {
                rawArrBuf = await file.arrayBuffer();
                standaloneBlob = new Blob([rawArrBuf], { type: mimeType });
              } catch {
                standaloneBlob = await materializeAudioBlob(file);
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
              pendingTracks.push(
                createLocalTrack({
                  id,
                  title: cleanTitle,
                  duration,
                  mimeType,
                  bpm,
                  beatOffset,
                  createdAt: Date.now() + i,
                })
              );

              if (pendingTracks.length >= BATCH_SIZE) {
                await flushChunk();
              }
            } catch {
              // Skip unreadable individual file and continue batch
            }
          }
        }

        await flushChunk();

        if (totalCreated > 0) {
          onImportedFocusStudio();
          setImportSuccessCount(totalCreated);
          importSuccessTimerRef.current = window.setTimeout(() => {
            setImportSuccessCount(null);
            importSuccessTimerRef.current = null;
          }, 2800);
        } else if (storageWriteFailures > 0) {
          showImportError(storageErrorLabel);
        } else {
          showImportError(emptyErrorLabel);
        }
      } catch {
        if (totalCreated === 0) {
          showImportError(storageWriteFailures > 0 ? storageErrorLabel : emptyErrorLabel);
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
    [
      activeSetlistIdRef,
      allTracksCustomOrderRef,
      blobCacheRef,
      clearFeedbackTimers,
      emptyErrorLabel,
      maxBlobCache,
      onImportedFocusStudio,
      setActiveTrackId,
      setSetlists,
      setTracks,
      showImportError,
      storageErrorLabel,
      tracksRef,
    ]
  );

  return {
    isImporting,
    importStatus,
    importSuccessCount,
    importErrorNotice,
    showImportError,
    handlePreparingImport,
    handleImportEmpty,
    handleImportFiles,
  };
}
