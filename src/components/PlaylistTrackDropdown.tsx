import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownAZ, ChevronDown, GripVertical, Pencil, Trash2, Undo2 } from 'lucide-react';
import { formatTimecode } from '../audio/audioUtils';
import { useTrackPointerReorder } from '../hooks/useTrackPointerReorder';
import { TranslationDict } from '../i18n/translations';
import { PracticeTrack } from '../types/studio';

interface PlaylistTrackDropdownProps {
  tracks: PracticeTrack[];
  activeTrackId: string;
  isAlphabetical: boolean;
  canResetOrder: boolean;
  t: TranslationDict;
  onSelectTrack: (trackId: string) => void;
  onReorderTracks: (orderedIds: string[]) => void;
  onSortAlphabetical: () => void;
  onResetOrder: () => void;
  onRequestRenameTrack: (track: PracticeTrack) => void;
  onRequestDeleteTrack: (track: PracticeTrack) => void;
  onOpenFullView?: () => void;
  onUnlockAudio?: () => void;
  onPrewarmTrack?: (trackId: string) => void;
  onPrefetchTracks?: (trackIds: string[]) => () => void;
}

export const PlaylistTrackDropdown: React.FC<PlaylistTrackDropdownProps> = React.memo(({
  tracks,
  activeTrackId,
  isAlphabetical,
  canResetOrder,
  t,
  onSelectTrack,
  onReorderTracks,
  onSortAlphabetical,
  onResetOrder,
  onRequestRenameTrack,
  onRequestDeleteTrack,
  onOpenFullView,
  onUnlockAudio,
  onPrewarmTrack,
  onPrefetchTracks,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const {
    draggingId,
    displayTracks,
    registerRowRef,
    startHold,
    clearHoldTimer,
    draggingIdRef,
    isDragBlockingClick,
  } = useTrackPointerReorder({
    tracks,
    isActive: isOpen,
    onReorderTracks,
  });

  const activeTrack = useMemo(
    () => tracks.find((tr) => tr.id === activeTrackId) || tracks[0],
    [activeTrackId, tracks]
  );

  // Close dropdown when clicking outside (unless actively dragging) & prefetch open dropdown tracks
  useEffect(() => {
    if (!isOpen) return;
    const cancelPrefetch = onPrefetchTracks?.(tracks.slice(0, 10).map((tr) => tr.id));
    const onDocPointerDown = (e: PointerEvent) => {
      if (draggingIdRef.current) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => {
      cancelPrefetch?.();
      document.removeEventListener('pointerdown', onDocPointerDown);
    };
  }, [draggingIdRef, isOpen, tracks, onPrefetchTracks]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button opening full playlist view or inline dropdown + quick rename pencil button */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            onUnlockAudio?.();
            if (onOpenFullView) {
              onOpenFullView();
            } else {
              setIsOpen((v) => !v);
            }
          }}
          aria-expanded={onOpenFullView ? undefined : isOpen}
          className={`flex-1 min-w-0 min-h-[42px] px-3 rounded-xl bg-[var(--surface-base)] border transition-colors flex items-center justify-between gap-2 text-left cursor-pointer ${
            isOpen
              ? 'border-amber-500'
              : 'border-[var(--surface-border)] hover:border-slate-400 dark:hover:border-zinc-500'
          }`}
        >
          <span className="font-display text-sm sm:text-base font-semibold text-slate-900 dark:text-zinc-100 truncate">
            {activeTrack ? activeTrack.title : t.live.noTracksEmpty}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-slate-500 dark:text-zinc-400 shrink-0 transition-transform duration-150 ${
              onOpenFullView
                ? '-rotate-90 text-amber-600 dark:text-amber-400'
                : isOpen
                  ? 'rotate-180 text-amber-600 dark:text-amber-400'
                  : ''
            }`}
          />
        </button>

        {activeTrack && (
          <button
            type="button"
            onClick={() => onRequestRenameTrack(activeTrack)}
            title={t.live.renameTrackTitle}
            aria-label={t.live.renameTrackTitle}
            className="min-w-[42px] min-h-[42px] rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-amber-500/60 text-slate-600 dark:text-zinc-300 hover:text-amber-700 dark:hover:text-amber-400 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Expandable Playlist Dropdown with Hold-to-Reorder, A-Z Sort, Reset & Trash */}
      {isOpen && (
        <div className="mt-2 rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] overflow-hidden shadow-xl">
          <div className="px-3 py-2 border-b border-[var(--surface-border-subtle)] flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500 dark:text-zinc-400">
              {draggingId ? (
                <span className="font-semibold text-amber-700 dark:text-amber-400">{t.live.movingTrack}</span>
              ) : (
                t.live.holdToReorder
              )}
            </span>

            {displayTracks.length > 1 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSortAlphabetical();
                  }}
                  disabled={isAlphabetical}
                  className={`min-h-[30px] px-2.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
                    isAlphabetical
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300 cursor-default'
                      : 'bg-[var(--surface-control)] border-[var(--surface-border)] hover:border-amber-500/60 text-slate-800 dark:text-zinc-200'
                  }`}
                >
                  <ArrowDownAZ className="w-3.5 h-3.5 shrink-0" />
                  <span>{t.setlists.sortAlphabetical}</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onResetOrder();
                  }}
                  disabled={!canResetOrder}
                  title={t.setlists.resetOrderTitle}
                  className="min-h-[30px] px-2.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-control)] hover:border-slate-400 dark:hover:border-zinc-500 disabled:opacity-35 disabled:cursor-not-allowed text-[11px] font-semibold text-slate-800 dark:text-zinc-200 flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors"
                >
                  <Undo2 className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>{t.setlists.resetOrder}</span>
                </button>
              </div>
            )}
          </div>

          {displayTracks.length === 0 ? (
            <div className="p-4 text-xs text-slate-500 dark:text-zinc-400 text-center">
              {t.live.noTracksEmpty}
            </div>
          ) : (
            <div
              data-no-tab-swipe={draggingId ? 'true' : undefined}
              className={`max-h-72 overflow-y-auto divide-y divide-[var(--surface-border-subtle)] ${
                draggingId ? 'select-none touch-none' : ''
              }`}
            >
              {displayTracks.map((tr) => {
                const isSelected = tr.id === activeTrackId;
                const isHeld = draggingId === tr.id;
                const anotherHeld = draggingId !== null && !isHeld;

                return (
                  <div
                    key={tr.id}
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
                      setIsOpen(false);
                    }}
                    className={`min-h-[50px] px-2.5 py-2 flex items-center gap-2 transition-transform select-none cursor-pointer ${
                      isHeld
                        ? 'relative z-10 bg-amber-500/20 border-y border-amber-500 dark:border-amber-400 scale-[1.01] shadow-lg'
                        : isSelected
                          ? 'bg-amber-50 dark:bg-[var(--surface-control)]'
                          : 'hover:bg-slate-50 dark:hover:bg-[var(--surface-control)]/50'
                    } ${anotherHeld ? 'opacity-55' : ''}`}
                  >
                    <span
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        startHold(e, tr.id, 90);
                      }}
                      className="p-1 -ml-1 flex items-center justify-center shrink-0 touch-none"
                    >
                      <GripVertical
                        className={`w-4 h-4 shrink-0 ${
                          isHeld ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-zinc-500'
                        }`}
                      />
                    </span>

                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          isHeld || isSelected
                            ? 'text-amber-800 dark:text-amber-300'
                            : 'text-slate-900 dark:text-zinc-100'
                        }`}
                      >
                        {tr.title}
                      </p>
                      <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-zinc-400 mt-0.5">
                        {formatTimecode(tr.duration)} · {Math.round((tr.preset.bpm || 100) * tr.preset.speed)} BPM
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
                        className="min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-amber-700 dark:hover:text-amber-400 hover:bg-amber-500/15 shrink-0 cursor-pointer"
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
                        className="min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/15 shrink-0 cursor-pointer"
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
      )}
    </div>
  );
});
