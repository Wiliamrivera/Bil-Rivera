import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportTrackAudioToWav } from '../audio/audioUtils';
import { PracticeTrack } from '../types/studio';
import {
  hasNativeAndroidSaveBridge,
  hasNativeAndroidShareBridge,
  saveAudioFileNative,
  shareAudioFileNative,
} from '../utils/nativeBridge';
import { sanitizeExportFileName } from '../utils/trackUtils';

export interface ReadyExportData {
  blob: Blob;
  fileName: string;
  url: string;
}

interface UseAudioExportOptions {
  activeTrack: PracticeTrack | undefined;
  audioBuffer: AudioBuffer | null;
  swapLR: boolean;
  isMobileClient: boolean;
  onExportError?: (message: string) => void;
  onExportSuccess?: (message: string) => void;
  exportErrorLabel: string;
  exportSavedLabel: string;
}

export function useAudioExport({
  activeTrack,
  audioBuffer,
  swapLR,
  isMobileClient,
  onExportError,
  onExportSuccess,
  exportErrorLabel,
  exportSavedLabel,
}: UseAudioExportOptions) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [readyExport, setReadyExport] = useState<ReadyExportData | null>(null);

  const exportCleanupTimerRef = useRef<number | null>(null);
  const readyExportUrlRef = useRef<string | null>(null);
  readyExportUrlRef.current = readyExport?.url ?? null;

  useEffect(() => {
    return () => {
      if (exportCleanupTimerRef.current !== null) {
        window.clearTimeout(exportCleanupTimerRef.current);
      }
      if (readyExportUrlRef.current) {
        URL.revokeObjectURL(readyExportUrlRef.current);
      }
    };
  }, []);

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
    if (!activeTrack || !audioBuffer || isExporting) return;
    if (exportCleanupTimerRef.current !== null) {
      window.clearTimeout(exportCleanupTimerRef.current);
      exportCleanupTimerRef.current = null;
    }
    setIsExporting(true);
    setExportProgress(0);
    try {
      const { speed, pitchSemitones, pitchCents, volumeL, volumeR } = activeTrack.preset;
      const wavBlob = await exportTrackAudioToWav({
        source: audioBuffer,
        speed,
        totalSemitones: pitchSemitones + pitchCents / 100,
        volumeL: volumeL ?? 1,
        volumeR: volumeR ?? 1,
        swapLR,
        onProgress: (p) => setExportProgress(Math.round(p * 100)),
      });

      const fileName = sanitizeExportFileName(activeTrack.title);
      const url = URL.createObjectURL(wavBlob);

      setReadyExport((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { blob: wavBlob, fileName, url };
      });
    } catch {
      onExportError?.(exportErrorLabel);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [activeTrack, audioBuffer, exportErrorLabel, isExporting, onExportError, swapLR]);

  const triggerDirectDownload = useCallback(
    (exp: { url: string; fileName: string; blob?: Blob }) => {
      if (exp.blob && hasNativeAndroidSaveBridge()) {
        void saveAudioFileNative(exp.blob, exp.fileName).then((saved) => {
          if (saved) {
            onExportSuccess?.(exportSavedLabel);
            clearReadyExport();
          } else {
            onExportError?.(exportErrorLabel);
          }
        });
        return;
      }

      const a = document.createElement('a');
      a.href = exp.url;
      a.download = exp.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    [clearReadyExport, exportErrorLabel, exportSavedLabel, onExportError, onExportSuccess]
  );

  const canShareExportFile = useMemo(() => {
    if (hasNativeAndroidShareBridge()) return true;
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

    if (hasNativeAndroidSaveBridge()) {
      const saved = await saveAudioFileNative(blob, fileName);
      if (saved) {
        onExportSuccess?.(exportSavedLabel);
        clearReadyExport();
        return;
      }
      onExportError?.(exportErrorLabel);
      return;
    }

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
        onExportSuccess?.(exportSavedLabel);
        clearReadyExport();
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
      }
    }

    triggerDirectDownload(readyExport);
    scheduleReadyExportCleanup(5000);
  }, [
    clearReadyExport,
    exportErrorLabel,
    exportSavedLabel,
    onExportError,
    onExportSuccess,
    readyExport,
    scheduleReadyExportCleanup,
    triggerDirectDownload,
  ]);

  const handleShareExport = useCallback(async () => {
    if (!readyExport) return;
    const { blob, fileName } = readyExport;

    if (hasNativeAndroidShareBridge()) {
      const shared = await shareAudioFileNative(blob, fileName);
      if (shared) {
        clearReadyExport();
        return;
      }
    }

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

    await handleChooseSaveLocation();
  }, [clearReadyExport, handleChooseSaveLocation, readyExport]);

  return {
    isExporting,
    exportProgress,
    readyExport,
    canShareExportFile,
    clearReadyExport,
    scheduleReadyExportCleanup,
    handleExportAudio,
    triggerDirectDownload,
    handleChooseSaveLocation,
    handleShareExport,
  };
}
