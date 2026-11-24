import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PracticeTrack } from '../types/studio';

interface UseTrackPointerReorderOptions {
  tracks: PracticeTrack[];
  isActive?: boolean;
  onReorderTracks: (orderedIds: string[]) => void;
}

export function useTrackPointerReorder({
  tracks,
  isActive = true,
  onReorderTracks,
}: UseTrackPointerReorderOptions) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOrderIds, setDragOrderIds] = useState<string[] | null>(null);

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

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const onReorderRef = useRef(onReorderTracks);
  onReorderRef.current = onReorderTracks;

  draggingIdRef.current = draggingId;
  dragOrderIdsRef.current = dragOrderIds;

  const displayTracks = useMemo(() => {
    if (!dragOrderIds) return tracks;
    const map = new Map(tracks.map((tr) => [tr.id, tr]));
    return dragOrderIds.map((id) => map.get(id)).filter((tr): tr is PracticeTrack => Boolean(tr));
  }, [dragOrderIds, tracks]);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (justDraggedTimerRef.current !== null) {
        window.clearTimeout(justDraggedTimerRef.current);
        justDraggedTimerRef.current = null;
      }
      clearHoldTimer();
    };
  }, [clearHoldTimer]);

  useEffect(() => {
    if (!isActive) {
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
          onReorderRef.current(finalOrder);
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
  }, [clearHoldTimer, isActive]);

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

  const startHold = useCallback(
    (e: React.PointerEvent, trackId: string, delayMs = 300) => {
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
        const initialIds = tracksRef.current.map((tr) => tr.id);
        draggingIdRef.current = trackId;
        dragOrderIdsRef.current = initialIds;
        setDraggingId(trackId);
        setDragOrderIds(initialIds);
      }, delayMs);
    },
    [clearHoldTimer]
  );

  const registerRowRef = useCallback((trackId: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(trackId, el);
    else rowRefs.current.delete(trackId);
  }, []);

  const isDragBlockingClick = useCallback(
    () => Boolean(justDraggedRef.current || draggingIdRef.current),
    []
  );

  return {
    draggingId,
    displayTracks,
    rowRefs,
    registerRowRef,
    startHold,
    clearHoldTimer,
    draggingIdRef,
    isDragBlockingClick,
  };
}
