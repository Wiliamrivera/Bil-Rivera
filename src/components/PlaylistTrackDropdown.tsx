import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownAZ, ChevronDown, GripVertical, Trash2, Undo2 } from 'lucide-react';
import { formatTimecode } from '../audio/audioUtils';
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
  onRequestDeleteTrack,
  onOpenFullView,
  onUnlockAudio,
  onPrewarmTrack,
  onPrefetchTracks,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOrderIds, setDragOrderIds] = useState<string[] | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const holdTimerRef = useRef<number | null>(null);
  const pointerStateRef = useRef<{
    trackId: string;
    startX: number;
    startY: number;
    pointerId: number;
  } | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dragOrderIdsRef = useRef<string[] | null>(null);
  const justDraggedRef = useRef<boolean>(false);
  const justDraggedTimerRef = useRef<number | null>(null);

  draggingIdRef.current = draggingId;
  dragOrderIdsRef.current = dragOrderIds;

  const activeTrack = useMemo(
    () => tracks.find((tr) => tr.id === activeTrackId) || tracks[0],
    [activeTrackId, tracks]
  );

  const displayTracks = useMemo(() => {
    if (!dragOrderIds) return tracks;
    const map = new Map(tracks.map((tr) => [tr.id, tr]));
    return dragOrderIds.map((id) => map.get(id)).filter((tr): tr is PracticeTrack => Boolean(tr));
  }, [dragOrderIds, tracks]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (justDraggedTimerRef.current !== null) {
        window.clearTimeout(justDraggedTimerRef.current);
      }
      clearHoldTimer();
    };
  }, []);

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
  }, [isOpen, tracks, onPrefetchTracks]);

  // Global pointer tracking only while the dropdown is open
  useEffect(() => {
    if (!isOpen) {
      clearHoldTimer();
      pointerStateRef.current = null;
      draggingIdRef.current = null;
      dragOrderIdsRef.current = null;
      setDraggingId(null);
      setDragOrderIds(null);
      return;
    }

    const handlePointerMove = (e: PointerEvent) => {
      const pending = pointerStateRef.current;
      const activeDragId = draggingIdRef.current;

      // Cancel hold timer only if the tracked pointer moved before delay completed
      if (!activeDragId && pending) {
        if (e.pointerId !== pending.pointerId) return;
        const dx = Math.abs(e.clientX - pending.startX);
        const dy = Math.abs(e.clientY - pending.startY);
        if (dx > 8 || dy > 8) {
          clearHoldTimer();
          pointerStateRef.current = null;
        }
        return;
      }

      if (!activeDragId) return;
      if (pending && e.pointerId !== pending.pointerId) return;

      const currentOrder = dragOrderIdsRef.current;
      if (!currentOrder || currentOrder.length < 2) return;

      const currentIdx = currentOrder.indexOf(activeDragId);
      if (currentIdx === -1) return;

      const y = e.clientY;
      let targetIdx = currentIdx;

      for (let i = 0; i < currentOrder.length; i++) {
        const id = currentOrder[i];
        if (id === activeDragId) continue;
        const el = rowRefs.current.get(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const midY = (rect.top + rect.bottom) / 2;
        if (i < currentIdx && y < midY) {
          targetIdx = i;
          break;
        }
        if (i > currentIdx && y > midY) {
          targetIdx = i;
        }
      }

      if (targetIdx !== currentIdx) {
        const nextOrder = [...currentOrder];
        nextOrder.splice(currentIdx, 1);
        nextOrder.splice(targetIdx, 0, activeDragId);
        dragOrderIdsRef.current = nextOrder;
        setDragOrderIds(nextOrder);
      }
    };

    const finishDrag = (e: PointerEvent) => {
      const pending = pointerStateRef.current;
      if (pending && e.pointerId !== pending.pointerId) return;

      clearHoldTimer();
      pointerStateRef.current = null;

      if (draggingIdRef.current) {
        const finalOrder = dragOrderIdsRef.current;
        if (finalOrder && finalOrder.length > 0) {
          onReorderTracks(finalOrder);
        }
        justDraggedRef.current = true;
        if (justDraggedTimerRef.current !== null) {
          window.clearTimeout(justDraggedTimerRef.current);
        }
        justDraggedTimerRef.current = window.setTimeout(() => {
          justDraggedRef.current = false;
          justDraggedTimerRef.current = null;
        }, 120);
      }

      draggingIdRef.current = null;
      dragOrderIdsRef.current = null;
      setDraggingId(null);
      setDragOrderIds(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      clearHoldTimer();
    };
  }, [isOpen, onReorderTracks]);

  // Lock page scrolling only while an item is actively being dragged
  useEffect(() => {
    if (!draggingId) return;
    const preventScrollWhileDragging = (e: TouchEvent) => {
      e.preventDefault();
    };
    window.addEventListener('touchmove', preventScrollWhileDragging, { passive: false });
    return () => {
      window.removeEventListener('touchmove', preventScrollWhileDragging);
    };
  }, [draggingId]);

  const startHold = (e: React.PointerEvent, trackId: string, delayMs = 300) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    clearHoldTimer();
    pointerStateRef.current = {
      trackId,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
    };

    holdTimerRef.current = window.setTimeout(() => {
      if (!pointerStateRef.current || pointerStateRef.current.trackId !== trackId) return;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(25);
      }
      const initialIds = tracks.map((tr) => tr.id);
      draggingIdRef.current = trackId;
      dragOrderIdsRef.current = initialIds;
      setDraggingId(trackId);
      setDragOrderIds(initialIds);
    }, delayMs);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button opening full playlist view or inline dropdown */}
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
        className={`w-full min-h-[42px] px-3 rounded-xl bg-[var(--surface-base)] border transition-colors flex items-center justify-between gap-2 text-left cursor-pointer ${
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
                    ref={(el) => {
                      if (el) rowRefs.current.set(tr.id, el);
                      else rowRefs.current.delete(tr.id);
                    }}
                    onMouseEnter={() => onPrewarmTrack?.(tr.id)}
                    onPointerDown={(e) => {
                      onPrewarmTrack?.(tr.id);
                      startHold(e, tr.id, 300);
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={() => {
                      if (justDraggedRef.current || draggingIdRef.current) return;
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
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
