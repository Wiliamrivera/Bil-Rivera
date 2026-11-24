import React, { useEffect, useRef } from 'react';
import {
  ArrowDownAZ,
  ArrowLeft,
  GripVertical,
  ListMusic,
  Loader2,
  Pencil,
  Play,
  Trash2,
  Undo2,
  Upload,
  Volume2,
} from 'lucide-react';
import { formatTimecode } from '../audio/audioUtils';
import { useTrackPointerReorder } from '../hooks/useTrackPointerReorder';
import { TranslationDict } from '../i18n/translations';
import { PracticeTrack } from '../types/studio';

interface PlaylistTracksViewProps {
  playlistName: string;
  tracks: PracticeTrack[];
  activeTrackId: string;
  isPlaying?: boolean;
  isImporting?: boolean;
  isAlphabetical: boolean;
  canResetOrder: boolean;
  t: TranslationDict;
  onBack: () => void;
  onSelectTrack: (trackId: string) => void;
  onReorderTracks: (orderedIds: string[]) => void;
  onSortAlphabetical: () => void;
  onResetOrder: () => void;
  onRequestRenameTrack: (track: PracticeTrack) => void;
  onRequestDeleteTrack: (track: PracticeTrack) => void;
  onUploadTracks?: () => void;
  onPrewarmTrack?: (trackId: string) => void;
  onPrefetchTracks?: (trackIds: string[]) => () => void;
}

export const PlaylistTracksView: React.FC<PlaylistTracksViewProps> = React.memo(({
  playlistName,
  tracks,
  activeTrackId,
  isPlaying = false,
  isImporting = false,
  isAlphabetical,
  canResetOrder,
  t,
  onBack,
  onSelectTrack,
  onReorderTracks,
  onSortAlphabetical,
  onResetOrder,
  onRequestRenameTrack,
  onRequestDeleteTrack,
  onUploadTracks,
  onPrewarmTrack,
  onPrefetchTracks,
}) => {
  const {
    draggingId,
    displayTracks,
    rowRefs,
    registerRowRef,
    startHold,
    clearHoldTimer,
    isDragBlockingClick,
  } = useTrackPointerReorder({
    tracks,
    isActive: true,
    onReorderTracks,
  });

  const visibleTrackIdsRef = useRef<Set<string>>(new Set());
  const visiblePrefetchCancelRef = useRef<(() => void) | null>(null);
  const visiblePrefetchTimerRef = useRef<number | null>(null);
  const onPrefetchTracksRef = useRef(onPrefetchTracks);
  onPrefetchTracksRef.current = onPrefetchTracks;

  // Pre-decode visible rows when scrolling through large playlists (e.g. "Todas as Músicas")
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !onPrefetchTracksRef.current) return;
    visibleTrackIdsRef.current.clear();

    const scheduleVisiblePrefetch = () => {
      if (visiblePrefetchTimerRef.current !== null) {
        window.clearTimeout(visiblePrefetchTimerRef.current);
      }
      visiblePrefetchTimerRef.current = window.setTimeout(() => {
        visiblePrefetchTimerRef.current = null;
        visiblePrefetchCancelRef.current?.();
        const visible = Array.from(visibleTrackIdsRef.current);
        if (visible.length > 0 && onPrefetchTracksRef.current) {
          visiblePrefetchCancelRef.current = onPrefetchTracksRef.current(visible.slice(0, 8));
        }
      }, 140);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.trackId;
          if (!id) continue;
          if (entry.isIntersecting) {
            if (!visibleTrackIdsRef.current.has(id)) {
              visibleTrackIdsRef.current.add(id);
              changed = true;
            }
          } else if (visibleTrackIdsRef.current.delete(id)) {
            changed = true;
          }
        }
        if (changed) scheduleVisiblePrefetch();
      },
      { threshold: 0.1 }
    );

    rowRefs.current.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      if (visiblePrefetchTimerRef.current !== null) {
        window.clearTimeout(visiblePrefetchTimerRef.current);
        visiblePrefetchTimerRef.current = null;
      }
      visiblePrefetchCancelRef.current?.();
      visiblePrefetchCancelRef.current = null;
    };
  }, [rowRefs, tracks]);

  return (
    <div className="flex flex-col gap-3 max-w-2xl mx-auto">
      {/* Sticky Top Action Bar */}
      <div className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-3 flex flex-col gap-2.5 shadow-sm dark:shadow-none">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[42px] px-3 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-amber-500/60 text-slate-900 dark:text-zinc-100 text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
            <span>{t.live.backToStudio}</span>
          </button>

          <div className="flex items-center gap-2 min-w-0 flex-1 justify-end text-right">
            <ListMusic className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-zinc-100 truncate">
              {playlistName}
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-zinc-400 shrink-0">
              · {tracks.length} {t.setlists.tracksCount}
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-[var(--surface-border-subtle)] flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500 dark:text-zinc-400">
            {draggingId ? (
              <span className="font-semibold text-amber-700 dark:text-amber-400">
                {t.live.movingTrack}
              </span>
            ) : (
              t.live.playlistTracksHint
            )}
          </span>

          {displayTracks.length > 1 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onSortAlphabetical}
                disabled={isAlphabetical}
                className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                  isAlphabetical
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-300 cursor-default'
                    : 'bg-[var(--surface-control)] border-[var(--surface-border)] hover:border-amber-500/60 text-slate-800 dark:text-zinc-200'
                }`}
              >
                <ArrowDownAZ className="w-3.5 h-3.5 shrink-0" />
                <span>{t.setlists.sortAlphabetical}</span>
              </button>

              <button
                type="button"
                onClick={onResetOrder}
                disabled={!canResetOrder}
                title={t.setlists.resetOrderTitle}
                className="min-h-[34px] px-2.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-control)] hover:border-slate-400 dark:hover:border-zinc-500 disabled:opacity-35 disabled:cursor-not-allowed text-xs font-semibold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
              >
                <Undo2 className="w-3.5 h-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
                <span>{t.setlists.resetOrder}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Full Playlist Track List */}
      <div className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl overflow-hidden shadow-sm dark:shadow-none">
        {displayTracks.length === 0 ? (
          <div className="p-8 text-center flex flex-col items-center gap-3">
            <p className="text-sm text-slate-600 dark:text-zinc-400">{t.live.noTracksEmpty}</p>
            {onUploadTracks && (
              <button
                type="button"
                disabled={isImporting}
                onClick={onUploadTracks}
                className="min-h-[42px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-[var(--accent-fg)] text-sm font-bold flex items-center gap-2 cursor-pointer"
              >
                {isImporting ? (
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 shrink-0" />
                )}
                <span>{isImporting ? t.uploadModal.uploadingShort : t.importAudio}</span>
              </button>
            )}
          </div>
        ) : (
          <div
            data-no-tab-swipe="true"
            className={`divide-y divide-[var(--surface-border-subtle)] ${
              draggingId ? 'select-none touch-none' : ''
            }`}
          >
            {displayTracks.map((tr, idx) => {
              const isSelected = tr.id === activeTrackId;
              const isHeld = draggingId === tr.id;
              const anotherHeld = draggingId !== null && !isHeld;
              const effBpm = Math.round((tr.preset.bpm || 100) * tr.preset.speed);

              return (
                <div
                  key={tr.id}
                  data-track-id={tr.id}
                  ref={(el) => registerRowRef(tr.id, el)}
                  onMouseEnter={() => onPrewarmTrack?.(tr.id)}
                  onPointerDown={(e) => {
                    onPrewarmTrack?.(tr.id);
                    startHold(e, tr.id, 300);
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() => {
                    if (isDragBlockingClick()) return;
                    onSelectTrack(tr.id);
                  }}
                  className={`min-h-[56px] px-3 py-2.5 flex items-center gap-2.5 transition-colors select-none cursor-pointer ${
                    isHeld
                      ? 'relative z-10 bg-amber-500/20 border-y border-amber-500 dark:border-amber-400 shadow-lg'
                      : isSelected
                        ? 'bg-amber-500/10'
                        : 'hover:bg-slate-50 dark:hover:bg-[var(--surface-control)]/60'
                  } ${anotherHeld ? 'opacity-55' : ''}`}
                >
                  <span
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      startHold(e, tr.id, 90);
                    }}
                    className="p-1.5 -ml-1 flex items-center justify-center shrink-0 touch-none"
                  >
                    <GripVertical
                      className={`w-4 h-4 shrink-0 ${
                        isHeld ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-zinc-500'
                      }`}
                    />
                  </span>

                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-mono tabular-nums text-xs font-bold ${
                      isSelected
                        ? 'bg-amber-500 text-[var(--accent-fg)]'
                        : 'bg-[var(--surface-control)] text-slate-600 dark:text-zinc-300 border border-[var(--surface-border-subtle)]'
                    }`}
                  >
                    {isSelected ? (
                      isPlaying ? (
                        <Volume2 className="w-4 h-4 animate-pulse" />
                      ) : (
                        <Play className="w-4 h-4 fill-current" />
                      )
                    ) : (
                      idx + 1
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-semibold truncate ${
                        isHeld || isSelected
                          ? 'text-amber-800 dark:text-amber-300'
                          : 'text-slate-900 dark:text-zinc-100'
                      }`}
                    >
                      {tr.title}
                    </p>
                    <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-zinc-400 mt-0.5">
                      {formatTimecode(tr.duration)} · {effBpm} BPM
                    </p>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        clearHoldTimer();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestRenameTrack(tr);
                      }}
                      title={t.live.renameTrackTitle}
                      aria-label={t.live.renameTrackTitle}
                      className="min-w-[42px] min-h-[42px] rounded-lg flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-amber-700 dark:hover:text-amber-400 hover:bg-amber-500/15 shrink-0 cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        clearHoldTimer();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestDeleteTrack(tr);
                      }}
                      aria-label={t.live.deleteTrackTitle}
                      className="min-w-[42px] min-h-[42px] rounded-lg flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/15 shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

PlaylistTracksView.displayName = 'PlaylistTracksView';
