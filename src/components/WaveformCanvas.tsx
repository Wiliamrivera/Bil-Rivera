import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatTimecode } from '../audio/audioUtils';
import { AppColorPalette, SnapMode, SongSection } from '../types/studio';

interface WaveformCanvasProps {
  peaks: Float32Array;
  duration: number;
  currentTime: number;
  loopA: number | null;
  loopB: number | null;
  loopEnabled: boolean;
  bpm: number;
  beatsPerBar: number;
  beatOffset: number;
  sections: SongSection[];
  zoom: number;
  followPlayhead: boolean;
  snapMode: SnapMode;
  showBeatGrid?: boolean;
  compactLandscape?: boolean;
  theme?: 'dark' | 'light';
  palette?: AppColorPalette;
  onSeek: (time: number) => void;
  onLoopAChange: (time: number) => void;
  onLoopBChange: (time: number) => void;
  onSelectSection: (section: SongSection) => void;
  onLoopSection: (section: SongSection) => void;
  onZoomChange: (nextZoom: number) => void;
}

type DragTarget = 'playhead' | 'loopA' | 'loopB' | null;

const TOUCH_HOLD_MS = 550;
const TOUCH_CANCEL_MOVE_PX = 6;
const TOUCH_UNLOCK_DRAG_PX = 4;

interface WaveformColorScheme {
  bg: string;
  laneBg: string;
  rulerBg: string;
  divider: string;
  barUnplayed: string;
  barPlayed: string;
  barLoopUnplayed: string;
  barLoopPlayed: string;
  loopOverlay: string;
  markerActive: string;
  markerText: string;
  hoverPreview: string;
}

const WAVEFORM_COLORS: Record<AppColorPalette, { dark: WaveformColorScheme; light: WaveformColorScheme }> = {
  amber: {
    dark: {
      bg: '#11141A',
      laneBg: '#161A22',
      rulerBg: '#13171F',
      divider: '#242934',
      barUnplayed: '#3F4756',
      barPlayed: '#F59E0B',
      barLoopUnplayed: '#D97706',
      barLoopPlayed: '#FBBF24',
      loopOverlay: 'rgba(245, 158, 11, 0.14)',
      markerActive: '#F59E0B',
      markerText: '#0D0F12',
      hoverPreview: 'rgba(251, 191, 36, 0.85)',
    },
    light: {
      bg: '#F8FAFC',
      laneBg: '#EEF2F6',
      rulerBg: '#EFF2F6',
      divider: '#CBD5E1',
      barUnplayed: '#94A3B8',
      barPlayed: '#D97706',
      barLoopUnplayed: '#F59E0B',
      barLoopPlayed: '#B45309',
      loopOverlay: 'rgba(245, 158, 11, 0.14)',
      markerActive: '#D97706',
      markerText: '#FFFFFF',
      hoverPreview: 'rgba(217, 119, 6, 0.9)',
    },
  },
  crimson: {
    dark: {
      bg: '#181B26',
      laneBg: '#202432',
      rulerBg: '#1B1E2B',
      divider: '#32374D',
      barUnplayed: '#464C64',
      barPlayed: '#E11D48',
      barLoopUnplayed: '#BE123C',
      barLoopPlayed: '#FB7185',
      loopOverlay: 'rgba(225, 29, 72, 0.16)',
      markerActive: '#F43F5E',
      markerText: '#FFFFFF',
      hoverPreview: 'rgba(251, 113, 133, 0.85)',
    },
    light: {
      bg: '#FAF8FA',
      laneBg: '#F1EDF1',
      rulerBg: '#F1EDF1',
      divider: '#D9CFD7',
      barUnplayed: '#A199A4',
      barPlayed: '#E11D48',
      barLoopUnplayed: '#F43F5E',
      barLoopPlayed: '#9F1239',
      loopOverlay: 'rgba(225, 29, 72, 0.14)',
      markerActive: '#E11D48',
      markerText: '#FFFFFF',
      hoverPreview: 'rgba(190, 18, 60, 0.9)',
    },
  },
  mint: {
    dark: {
      bg: '#262B33',
      laneBg: '#2F353F',
      rulerBg: '#292F38',
      divider: '#434B58',
      barUnplayed: '#535C6B',
      barPlayed: '#3DD697',
      barLoopUnplayed: '#10B981',
      barLoopPlayed: '#6EE7B7',
      loopOverlay: 'rgba(61, 214, 151, 0.16)',
      markerActive: '#3DD697',
      markerText: '#0B1A14',
      hoverPreview: 'rgba(110, 231, 183, 0.88)',
    },
    light: {
      bg: '#F7FAF8',
      laneBg: '#EBF2EE',
      rulerBg: '#EBF2EE',
      divider: '#C7D6CE',
      barUnplayed: '#8FA398',
      barPlayed: '#059669',
      barLoopUnplayed: '#10B981',
      barLoopPlayed: '#047857',
      loopOverlay: 'rgba(5, 150, 105, 0.14)',
      markerActive: '#059669',
      markerText: '#FFFFFF',
      hoverPreview: 'rgba(4, 120, 87, 0.9)',
    },
  },
  cobalt: {
    dark: {
      bg: '#121926',
      laneBg: '#192334',
      rulerBg: '#151D2C',
      divider: '#2B3A53',
      barUnplayed: '#3F516E',
      barPlayed: '#3B82F6',
      barLoopUnplayed: '#2563EB',
      barLoopPlayed: '#60A5FA',
      loopOverlay: 'rgba(59, 130, 246, 0.16)',
      markerActive: '#3B82F6',
      markerText: '#FFFFFF',
      hoverPreview: 'rgba(96, 165, 250, 0.85)',
    },
    light: {
      bg: '#F7F9FC',
      laneBg: '#ECF1F8',
      rulerBg: '#ECF1F8',
      divider: '#C7D3E6',
      barUnplayed: '#91A2BC',
      barPlayed: '#2563EB',
      barLoopUnplayed: '#3B82F6',
      barLoopPlayed: '#1D4ED8',
      loopOverlay: 'rgba(37, 99, 235, 0.14)',
      markerActive: '#2563EB',
      markerText: '#FFFFFF',
      hoverPreview: 'rgba(29, 78, 216, 0.9)',
    },
  },
};

function drawLoopMarkerFlag(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number,
  headerH: number,
  waveBottom: number,
  loopEnabled: boolean,
  colors: WaveformColorScheme,
  label: 'A' | 'B'
): void {
  if (x < -12 || x > width + 12) return;
  const activeColor = loopEnabled ? colors.markerActive : '#64748B';

  ctx.strokeStyle = activeColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, headerH);
  ctx.lineTo(x, waveBottom);
  ctx.stroke();

  const flagW = 18;
  const flagH = 16;
  const fx = label === 'A' ? x : x - flagW;
  ctx.fillStyle = activeColor;
  ctx.fillRect(fx, headerH, flagW, flagH);
  ctx.fillStyle = loopEnabled ? colors.markerText : '#FFFFFF';
  ctx.font = '700 10px "JetBrains Mono", monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, fx + 5, headerH + flagH / 2 + 0.5);
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = React.memo(({
  peaks,
  duration,
  currentTime,
  loopA,
  loopB,
  loopEnabled,
  bpm,
  beatsPerBar,
  beatOffset,
  sections,
  zoom,
  followPlayhead,
  snapMode,
  showBeatGrid = true,
  compactLandscape = false,
  theme = 'dark',
  palette = 'amber',
  onSeek,
  onLoopAChange,
  onLoopBChange,
  onSelectSection,
  onLoopSection,
  onZoomChange,
}) => {
  const isDark = theme !== 'light';
  const colors = WAVEFORM_COLORS[palette]?.[isDark ? 'dark' : 'light'] || WAVEFORM_COLORS.amber[isDark ? 'dark' : 'light'];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewStart, setViewStart] = useState(0);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [touchScrubActive, setTouchScrubActive] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const dragTargetRef = useRef<DragTarget>(null);
  const holdTimerRef = useRef<number | null>(null);
  const lastTouchTimeRef = useRef<number>(0);
  const isCoarsePointerRef = useRef<boolean>(false);
  const touchMoveGuardRef = useRef<((ev: TouchEvent) => void) | null>(null);
  const touchHoldRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastClientX: number;
    targetMode: DragTarget;
    unlocked: boolean;
    hasDragged: boolean;
  } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(hover: none) and (pointer: coarse)');
    const sync = () => {
      isCoarsePointerRef.current = mq.matches;
    };
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  const viewSpan = duration > 0 ? duration / Math.max(1, zoom) : 1;

  // Clamp viewStart when zoom or duration changes
  useEffect(() => {
    if (duration <= 0) {
      setViewStart(0);
      return;
    }
    const maxStart = Math.max(0, duration - viewSpan);
    setViewStart((prev) => Math.max(0, Math.min(maxStart, prev)));
  }, [duration, viewSpan]);

  // Follow playhead smoothly when zoomed in
  useEffect(() => {
    if (!followPlayhead || zoom <= 1.05 || duration <= 0 || dragTarget !== null) return;
    if (currentTime < viewStart || currentTime > viewStart + viewSpan * 0.9) {
      const target = Math.max(0, Math.min(duration - viewSpan, currentTime - viewSpan * 0.18));
      setViewStart(target);
    }
  }, [currentTime, duration, followPlayhead, zoom, viewStart, viewSpan, dragTarget]);

  const snapIfEnabled = useCallback(
    (rawSec: number) => {
      const clamped = Math.max(0, Math.min(duration, rawSec));
      if (snapMode === 'off' || bpm <= 0) return clamped;
      const beatDur = 60 / bpm;
      const unit = snapMode === 'bar' ? beatDur * beatsPerBar : beatDur;
      const idx = Math.round((clamped - beatOffset) / unit);
      return Math.max(0, Math.min(duration, beatOffset + idx * unit));
    },
    [beatOffset, beatsPerBar, bpm, duration, snapMode]
  );

  const clientXToTime = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas || duration <= 0) return 0;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return viewStart + ratio * viewSpan;
    },
    [duration, viewSpan, viewStart]
  );

  const timeToX = useCallback(
    (time: number, width: number) => {
      if (viewSpan <= 0) return 0;
      return ((time - viewStart) / viewSpan) * width;
    },
    [viewSpan, viewStart]
  );

  // Render high-DPI waveform canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    const hasSections = sections.length > 0;
    const headerH = hasSections ? 24 : 0;
    const waveTop = headerH + 4;
    const waveBottom = height - 18; // Compact bottom timeline ruler
    const waveMid = (waveTop + waveBottom) / 2;
    const waveHalfH = Math.max(14, (waveBottom - waveTop) / 2 - 3);

    if (hasSections) {
      // Section lane background
      ctx.fillStyle = colors.laneBg;
      ctx.fillRect(0, 0, width, headerH);
      ctx.strokeStyle = colors.divider;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, headerH);
      ctx.lineTo(width, headerH);
      ctx.stroke();
    }

    // Bottom ruler background
    ctx.fillStyle = colors.rulerBg;
    ctx.fillRect(0, waveBottom, width, height - waveBottom);
    ctx.strokeStyle = colors.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, waveBottom);
    ctx.lineTo(width, waveBottom);
    ctx.stroke();

    if (duration > 0) {
      // Draw section spans
      sections.forEach((sec) => {
        const x1 = timeToX(sec.startTime, width);
        const x2 = timeToX(sec.endTime, width);
        if (x2 < 0 || x1 > width) return;
        const clampedX1 = Math.max(0, x1);
        const clampedX2 = Math.min(width, x2);
        const segW = clampedX2 - clampedX1;
        if (segW <= 1) return;

        ctx.fillStyle = `${sec.color}24`;
        ctx.fillRect(clampedX1, 0, segW, headerH);
        ctx.fillStyle = sec.color;
        ctx.fillRect(clampedX1, 0, segW, 3);

        ctx.strokeStyle = `${sec.color}55`;
        ctx.beginPath();
        ctx.moveTo(clampedX1, 0);
        ctx.lineTo(clampedX1, waveBottom);
        ctx.stroke();

        if (segW > 36) {
          ctx.fillStyle = isDark ? '#E5E7EB' : '#0F172A';
          ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
          ctx.textBaseline = 'middle';
          ctx.save();
          ctx.beginPath();
          ctx.rect(clampedX1 + 4, 2, segW - 8, headerH - 4);
          ctx.clip();
          ctx.fillText(sec.label, clampedX1 + 6, headerH / 2 + 1);
          ctx.restore();
        }
      });

      // Draw Beat & Bar Grid
      if (showBeatGrid && bpm > 0) {
        const beatDur = 60 / bpm;
        const firstBeatIdx = Math.max(0, Math.floor((viewStart - beatOffset) / beatDur));
        const lastBeatIdx = Math.ceil((viewStart + viewSpan - beatOffset) / beatDur);
        const pxPerBeat = (beatDur / viewSpan) * width;

        for (let b = firstBeatIdx; b <= lastBeatIdx; b++) {
          const bt = beatOffset + b * beatDur;
          if (bt < 0 || bt > duration) continue;
          const x = timeToX(bt, width);
          const isBar = ((b % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;

          if (!isBar && pxPerBeat < 14) continue;

          ctx.strokeStyle = isDark
            ? isBar
              ? 'rgba(255,255,255,0.12)'
              : 'rgba(255,255,255,0.04)'
            : isBar
              ? 'rgba(15,23,42,0.14)'
              : 'rgba(15,23,42,0.05)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, waveTop);
          ctx.lineTo(x, waveBottom);
          ctx.stroke();

          if (isBar && pxPerBeat * beatsPerBar > 28) {
            const barNum = Math.floor(b / beatsPerBar) + 1;
            ctx.fillStyle = isDark ? '#71717A' : '#64748B';
            ctx.font = '500 10px "JetBrains Mono", monospace';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(barNum), x + 4, waveBottom + 11);
          }
        }
      }

      // Draw A-B Loop Region Overlay
      if (loopA !== null && loopB !== null && loopB > loopA) {
        const ax = timeToX(loopA, width);
        const bx = timeToX(loopB, width);
        const clampedA = Math.max(0, ax);
        const clampedB = Math.min(width, bx);
        if (clampedB > clampedA) {
          ctx.fillStyle = loopEnabled
            ? colors.loopOverlay
            : isDark
              ? 'rgba(148, 163, 184, 0.08)'
              : 'rgba(100, 116, 139, 0.12)';
          ctx.fillRect(clampedA, headerH, clampedB - clampedA, waveBottom - headerH);
        }
      }

      // Center zero line
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.1)';
      ctx.beginPath();
      ctx.moveTo(0, waveMid);
      ctx.lineTo(width, waveMid);
      ctx.stroke();

      // Draw Waveform Bars (only switch fillStyle when color group changes)
      if (peaks.length > 0) {
        const barStep = 3;
        const barW = 2;
        const numBars = Math.floor(width / barStep);
        const hasLoop = loopA !== null && loopB !== null && loopB > loopA && loopEnabled;
        let lastStyle = -1;

        for (let i = 0; i < numBars; i++) {
          const x = i * barStep;
          const t = viewStart + (x / width) * viewSpan;
          if (t < 0 || t > duration) continue;

          const peakIdx = Math.min(peaks.length - 1, Math.max(0, Math.floor((t / duration) * peaks.length)));
          const amp = Math.max(0.03, peaks[peakIdx]);
          const barH = amp * waveHalfH;

          const inLoop = hasLoop && t >= (loopA as number) && t <= (loopB as number);
          const isPlayed = t <= currentTime;
          const styleCode = inLoop ? (isPlayed ? 3 : 2) : isPlayed ? 1 : 0;

          if (styleCode !== lastStyle) {
            lastStyle = styleCode;
            ctx.fillStyle =
              styleCode === 3
                ? colors.barLoopPlayed
                : styleCode === 2
                  ? colors.barLoopUnplayed
                  : styleCode === 1
                    ? colors.barPlayed
                    : colors.barUnplayed;
          }

          ctx.fillRect(x, waveMid - barH, barW, barH * 2);
        }
      }

      // Draw Loop A & Loop B Markers
      if (loopA !== null) {
        drawLoopMarkerFlag(
          ctx,
          timeToX(loopA, width),
          width,
          headerH,
          waveBottom,
          loopEnabled,
          colors,
          'A'
        );
      }
      if (loopB !== null) {
        drawLoopMarkerFlag(
          ctx,
          timeToX(loopB, width),
          width,
          headerH,
          waveBottom,
          loopEnabled,
          colors,
          'B'
        );
      }

      // Draw Hover / Touch-Preview Hairline
      if (hoverTime !== null && (dragTarget === null || touchScrubActive)) {
        const hx = timeToX(hoverTime, width);
        ctx.strokeStyle = touchScrubActive
          ? colors.hoverPreview
          : isDark
            ? 'rgba(255,255,255,0.25)'
            : 'rgba(15,23,42,0.35)';
        ctx.lineWidth = touchScrubActive ? 1.5 : 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, headerH);
        ctx.lineTo(hx, waveBottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw Playhead
      const px = timeToX(currentTime, width);
      if (px >= -2 && px <= width + 2) {
        const playheadColor = isDark ? '#FFFFFF' : '#0F172A';
        ctx.strokeStyle = playheadColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, headerH);
        ctx.lineTo(px, waveBottom);
        ctx.stroke();

        // Playhead triangle
        ctx.fillStyle = playheadColor;
        ctx.beginPath();
        ctx.moveTo(px - 6, headerH);
        ctx.lineTo(px + 6, headerH);
        ctx.lineTo(px, headerH + 8);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();
  }, [
    beatOffset,
    beatsPerBar,
    bpm,
    canvasSize,
    colors,
    currentTime,
    dragTarget,
    duration,
    hoverTime,
    isDark,
    loopA,
    loopB,
    loopEnabled,
    peaks,
    sections,
    showBeatGrid,
    timeToX,
    touchScrubActive,
    viewSpan,
    viewStart,
  ]);

  // Redraw when container resizes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      setCanvasSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }
    const obs = new ResizeObserver(updateSize);
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  const removeTouchMoveGuard = useCallback(() => {
    if (touchMoveGuardRef.current) {
      window.removeEventListener('touchmove', touchMoveGuardRef.current);
      touchMoveGuardRef.current = null;
    }
    containerRef.current?.removeAttribute('data-no-tab-swipe');
  }, []);

  const clearTouchHold = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    touchHoldRef.current = null;
    removeTouchMoveGuard();
  }, [removeTouchMoveGuard]);

  useEffect(() => {
    return () => clearTouchHold();
  }, [clearTouchHold]);

  const scrubHelpersRef = useRef({
    clientXToTime,
    snapIfEnabled,
    onSeek,
    onLoopAChange,
    onLoopBChange,
  });
  scrubHelpersRef.current = {
    clientXToTime,
    snapIfEnabled,
    onSeek,
    onLoopAChange,
    onLoopBChange,
  };

  const applyDragAtTime = useCallback(
    (target: DragTarget, snappedTime: number) => {
      if (target === 'playhead') {
        scrubHelpersRef.current.onSeek(snappedTime);
      } else if (target === 'loopA') {
        const maxA = loopB !== null ? loopB - 0.15 : duration;
        scrubHelpersRef.current.onLoopAChange(Math.min(maxA, snappedTime));
      } else if (target === 'loopB') {
        const minB = loopA !== null ? loopA + 0.15 : 0.15;
        scrubHelpersRef.current.onLoopBChange(Math.max(minB, snappedTime));
      }
    },
    [duration, loopA, loopB]
  );

  const isTouchPointerEvent = useCallback((pointerType: string) => {
    if (pointerType === 'touch') return true;
    if (pointerType === 'pen') return false;
    if (Date.now() - lastTouchTimeRef.current < 1200) return true;
    return isCoarsePointerRef.current;
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (duration <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isTouch = isTouchPointerEvent(e.pointerType);
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;
    const clickedTime = clientXToTime(e.clientX);

    // Clicking inside top section marker band jumps/loops section on desktop mouse only
    if (!isTouch && sections.length > 0 && y <= 26) {
      const hit = sections.find((s) => clickedTime >= s.startTime && clickedTime <= s.endTime);
      if (hit) {
        if (e.detail >= 2) {
          onLoopSection(hit);
        } else {
          onSelectSection(hit);
        }
        return;
      }
    }

    // Hit-test Loop A & Loop B handles within 12px
    const ax = loopA !== null ? timeToX(loopA, rect.width) : -999;
    const bx = loopB !== null ? timeToX(loopB, rect.width) : -999;
    const resolvedTarget: DragTarget =
      Math.abs(x - ax) <= 12 ? 'loopA' : Math.abs(x - bx) <= 12 ? 'loopB' : 'playhead';

    // Desktop mouse responds immediately; touch requires steady 550ms long-press + drag
    if (!isTouch) {
      canvas.setPointerCapture(e.pointerId);
      dragTargetRef.current = resolvedTarget;
      setDragTarget(resolvedTarget);
      applyDragAtTime(resolvedTarget, snapIfEnabled(clickedTime));
      return;
    }

    clearTouchHold();
    const pointerId = e.pointerId;
    touchHoldRef.current = {
      pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastClientX: e.clientX,
      targetMode: resolvedTarget,
      unlocked: false,
      hasDragged: false,
    };

    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      const pending = touchHoldRef.current;
      if (!pending || pending.pointerId !== pointerId) return;

      pending.unlocked = true;
      containerRef.current?.setAttribute('data-no-tab-swipe', 'true');

      // Synchronously prevent browser scroll while unlocked touch scrub is active
      if (!touchMoveGuardRef.current) {
        const preventScroll = (ev: TouchEvent) => {
          ev.preventDefault();
        };
        touchMoveGuardRef.current = preventScroll;
        window.addEventListener('touchmove', preventScroll, { passive: false });
      }

      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(30);
      }
      try {
        canvasRef.current?.setPointerCapture(pending.pointerId);
      } catch {
        // Ignore if pointer already released
      }

      dragTargetRef.current = pending.targetMode;
      setDragTarget(pending.targetMode);
      setTouchScrubActive(true);
      const t = scrubHelpersRef.current.clientXToTime(pending.lastClientX);
      setHoverTime(scrubHelpersRef.current.snapIfEnabled(t));
    }, TOUCH_HOLD_MS);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (duration <= 0) return;

    const pending = touchHoldRef.current;
    if (pending && e.pointerId === pending.pointerId) {
      pending.lastClientX = e.clientX;
      if (!pending.unlocked) {
        const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
        if (dist > TOUCH_CANCEL_MOVE_PX) {
          clearTouchHold();
        }
        return;
      }

      const t = clientXToTime(e.clientX);
      const snapped = snapIfEnabled(t);
      setHoverTime(snapped);

      if (!pending.hasDragged) {
        if (Math.abs(e.clientX - pending.startX) < TOUCH_UNLOCK_DRAG_PX) {
          return;
        }
        pending.hasDragged = true;
      }

      applyDragAtTime(pending.targetMode, snapped);
      return;
    }

    const isTouch = isTouchPointerEvent(e.pointerType);
    if (isTouch) {
      return;
    }

    const t = clientXToTime(e.clientX);
    setHoverTime(t);

    const activeTarget = dragTargetRef.current;
    if (!activeTarget) return;

    applyDragAtTime(activeTarget, snapIfEnabled(t));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const isTouch = isTouchPointerEvent(e.pointerType) || touchHoldRef.current?.pointerId === e.pointerId;
    if (touchHoldRef.current?.pointerId === e.pointerId || isTouch) {
      clearTouchHold();
    }
    if (dragTargetRef.current && canvasRef.current) {
      try {
        canvasRef.current.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    dragTargetRef.current = null;
    setDragTarget(null);
    setTouchScrubActive(false);
    if (isTouch) {
      setHoverTime(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (duration <= 0) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && zoom > 1) {
      const deltaSec = (e.deltaX / 400) * viewSpan;
      setViewStart((prev) => Math.max(0, Math.min(duration - viewSpan, prev + deltaSec)));
    } else if (e.ctrlKey || Math.abs(e.deltaY) > 0) {
      const factor = e.deltaY < 0 ? 1.25 : 0.8;
      const nextZoom = Math.max(1, Math.min(16, Number((zoom * factor).toFixed(2))));
      onZoomChange(nextZoom);
    }
  };

  const maxScroll = Math.max(0, duration - viewSpan);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={containerRef}
        data-no-tab-swipe={touchScrubActive ? 'true' : undefined}
        onTouchStartCapture={() => {
          lastTouchTimeRef.current = Date.now();
        }}
        onTouchMoveCapture={() => {
          lastTouchTimeRef.current = Date.now();
        }}
        onTouchCancel={() => {
          clearTouchHold();
          dragTargetRef.current = null;
          setDragTarget(null);
          setTouchScrubActive(false);
          setHoverTime(null);
        }}
        className={`relative w-full ${
          compactLandscape ? 'h-20' : 'h-24 sm:h-32 md:h-36'
        } rounded-xl overflow-hidden border transition-colors select-none [-webkit-touch-callout:none] ${
          touchScrubActive
            ? 'border-amber-500 ring-2 ring-amber-500/45 touch-none'
            : 'border-[var(--surface-border)] touch-pan-y'
        }`}
        style={{ backgroundColor: colors.bg }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
          onPointerLeave={(e) => {
            const isTouch = isTouchPointerEvent(e.pointerType);
            if (!isTouch) {
              setHoverTime(null);
            }
            if (!dragTargetRef.current && !touchHoldRef.current?.unlocked) {
              clearTouchHold();
              setDragTarget(null);
              setTouchScrubActive(false);
            }
          }}
          onWheel={handleWheel}
          className="w-full h-full block cursor-crosshair [-webkit-touch-callout:none]"
        />

        {touchScrubActive && duration > 0 && (
          <div className="pointer-events-none absolute top-2 left-2.5 px-2 py-0.5 rounded bg-amber-500 text-[var(--accent-fg)] text-[10px] font-bold tracking-wide uppercase shadow">
            Arraste p/ deslocar
          </div>
        )}

        {hoverTime !== null && duration > 0 && (
          <div className="pointer-events-none absolute top-2 right-2.5 px-2 py-0.5 rounded bg-[var(--surface-base-translucent)] border border-[var(--surface-border)] text-[11px] font-mono tabular-nums text-amber-700 dark:text-amber-300">
            {formatTimecode(hoverTime, true)}
          </div>
        )}
      </div>

      {/* Pan slider when zoomed in */}
      {zoom > 1.05 && maxScroll > 0 && (
        <div className="flex items-center gap-3 px-1">
          <span className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-zinc-500 whitespace-nowrap">
            {formatTimecode(viewStart)}
          </span>
          <input
            type="range"
            min={0}
            max={maxScroll}
            step={0.05}
            value={Math.min(maxScroll, viewStart)}
            onChange={(e) => setViewStart(parseFloat(e.target.value))}
            className="studio-slider w-full"
            aria-label="Waveform pan"
          />
          <span className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-zinc-500 whitespace-nowrap">
            {formatTimecode(Math.min(duration, viewStart + viewSpan))}
          </span>
        </div>
      )}
    </div>
  );
});
