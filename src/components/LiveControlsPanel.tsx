import React, { useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Gauge,
  Minus,
  Plus,
  RotateCcw,
  Sliders,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { TranslationDict } from '../i18n/translations';
import { TrackPreset } from '../types/studio';

interface LiveControlsPanelProps {
  preset: TrackPreset;
  swapLR: boolean;
  t: TranslationDict;
  onUpdatePreset: (patch: Partial<TrackPreset>) => void;
  onToggleSwapLR: () => void;
}

const MIN_BPM_SLIDER = 50;
const MAX_BPM_SLIDER = 150;

export const LiveControlsPanel: React.FC<LiveControlsPanelProps> = React.memo(
  ({ preset, swapLR, t, onUpdatePreset, onToggleSwapLR }) => {
    const [showPitchPanel, setShowPitchPanel] = useState(false);
    const [showBpmPanel, setShowBpmPanel] = useState(false);

    const prevVolLRef = useRef<number>(1);
    const prevVolRRef = useRef<number>(1);

    const volL = preset.volumeL ?? 1;
    const volR = preset.volumeR ?? 1;
    const pitchSt = preset.pitchSemitones;
    const pitchTones = pitchSt / 2;
    const pitchLabel =
      pitchTones === 0
        ? '0'
        : `${pitchTones > 0 ? '+' : ''}${Number.isInteger(pitchTones) ? pitchTones : pitchTones.toFixed(1)}`;
    const baseBpm = Math.max(40, Math.round(preset.bpm || 100));
    const speedPct = Math.round(preset.speed * 100);

    const setTargetSpeedPct = (targetPct: number) => {
      const clampedTarget = Math.max(50, Math.min(200, targetPct));
      onUpdatePreset({ speed: Number((clampedTarget / 100).toFixed(4)) });
    };

    const toggleMuteL = () => {
      if (volL > 0.01) {
        prevVolLRef.current = volL;
        onUpdatePreset({ volumeL: 0 });
      } else {
        onUpdatePreset({ volumeL: prevVolLRef.current > 0.05 ? prevVolLRef.current : 1 });
      }
    };

    const toggleMuteR = () => {
      if (volR > 0.01) {
        prevVolRRef.current = volR;
        onUpdatePreset({ volumeR: 0 });
      } else {
        onUpdatePreset({ volumeR: prevVolRRef.current > 0.05 ? prevVolRRef.current : 1 });
      }
    };

    return (
      <div className="flex flex-col gap-2 min-w-0">
        <section className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-2.5 sm:p-3 flex flex-col gap-2.5 shadow-sm dark:shadow-none">
          <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[var(--surface-border-subtle)]">
            <span className="text-xs font-medium text-slate-500 dark:text-zinc-400">
              {t.live.controlsHeader}
            </span>
            <button
              type="button"
              onClick={onToggleSwapLR}
              className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                swapLR
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-800 dark:text-amber-300'
                  : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-700 dark:text-zinc-300 hover:border-slate-400 dark:hover:border-zinc-500'
              }`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>{swapLR ? t.live.swapLRActive : t.live.swapLR}</span>
            </button>
          </div>

          {/* Pitch Button, Reset Arrow & Half-Tone Stepper */}
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowPitchPanel((v) => !v)}
                className={`justify-self-start min-h-[40px] px-2.5 sm:px-3 rounded-lg border flex items-center gap-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  pitchSt !== 0 || showPitchPanel
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-800 dark:text-amber-300'
                    : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-900 dark:text-zinc-100'
                }`}
              >
                <Sliders className="w-4 h-4 shrink-0" />
                <span>{t.live.pitchTitle}</span>
              </button>

              <button
                type="button"
                onClick={() => onUpdatePreset({ pitchSemitones: 0, pitchCents: 0 })}
                aria-label={t.live.resetPitch}
                title={t.live.resetPitch}
                className={`w-[38px] min-h-[40px] rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                  pitchSt !== 0
                    ? 'bg-amber-500/10 dark:bg-[var(--surface-control)] border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15'
                    : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                }`}
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onUpdatePreset({ pitchSemitones: Math.max(-12, pitchSt - 1) })}
                  aria-label="Pitch down half tone"
                  className="w-[38px] sm:w-[42px] min-h-[40px] rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-900 dark:text-zinc-100 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div
                  className={`min-h-[40px] w-[46px] sm:w-[50px] px-1 rounded-lg bg-[var(--surface-base)] border flex items-center justify-center font-mono tabular-nums text-xs font-semibold ${
                    pitchSt !== 0
                      ? 'border-amber-500/50 text-amber-800 dark:text-amber-300'
                      : 'border-[var(--surface-border)] text-slate-800 dark:text-zinc-200'
                  }`}
                >
                  {pitchLabel}
                </div>
                <button
                  type="button"
                  onClick={() => onUpdatePreset({ pitchSemitones: Math.min(12, pitchSt + 1) })}
                  aria-label="Pitch up half tone"
                  className="w-[38px] sm:w-[42px] min-h-[40px] rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-900 dark:text-zinc-100 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {showPitchPanel && (
              <div className="pt-0.5 pb-0.5">
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={pitchSt}
                  onChange={(e) => onUpdatePreset({ pitchSemitones: parseInt(e.target.value, 10) })}
                  className="studio-slider w-full"
                />
              </div>
            )}
          </div>

          {/* BPM Button, Reset Arrow & Tempo Stepper */}
          <div className="pt-2.5 border-t border-[var(--surface-border-subtle)] flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowBpmPanel((v) => !v)}
                className={`justify-self-start min-h-[40px] px-2.5 sm:px-3 rounded-lg border flex items-center gap-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  Math.abs(preset.speed - 1) > 0.005 || showBpmPanel
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-800 dark:text-amber-300'
                    : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-900 dark:text-zinc-100'
                }`}
              >
                <Gauge className="w-4 h-4 shrink-0" />
                <span>{t.live.bpmTitle}</span>
                <span className="font-mono tabular-nums ml-0.5">{baseBpm}</span>
              </button>

              <button
                type="button"
                onClick={() => onUpdatePreset({ speed: 1 })}
                aria-label={t.live.resetBpm}
                title={t.live.resetBpm}
                className={`w-[38px] min-h-[40px] rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                  Math.abs(preset.speed - 1) > 0.005
                    ? 'bg-amber-500/10 dark:bg-[var(--surface-control)] border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15'
                    : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                }`}
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setTargetSpeedPct(speedPct - 1)}
                  aria-label="BPM down"
                  className="w-[38px] sm:w-[42px] min-h-[40px] rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-900 dark:text-zinc-100 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div
                  className={`min-h-[40px] w-[46px] sm:w-[50px] px-1 rounded-lg bg-[var(--surface-base)] border flex items-center justify-center font-mono tabular-nums text-xs font-semibold ${
                    Math.abs(preset.speed - 1) > 0.005
                      ? 'border-amber-500/50 text-amber-800 dark:text-amber-300'
                      : 'border-[var(--surface-border)] text-slate-800 dark:text-zinc-200'
                  }`}
                >
                  {speedPct}
                </div>
                <button
                  type="button"
                  onClick={() => setTargetSpeedPct(speedPct + 1)}
                  aria-label="BPM up"
                  className="w-[38px] sm:w-[42px] min-h-[40px] rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-900 dark:text-zinc-100 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {showBpmPanel && (
              <div className="pt-0.5 pb-0.5 flex flex-col gap-2">
                <input
                  type="range"
                  min={MIN_BPM_SLIDER}
                  max={MAX_BPM_SLIDER}
                  step={1}
                  value={Math.max(MIN_BPM_SLIDER, Math.min(MAX_BPM_SLIDER, speedPct))}
                  onChange={(e) => setTargetSpeedPct(parseInt(e.target.value, 10))}
                  className="studio-slider w-full"
                />
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-zinc-400">
                  <span>{t.live.origBpm}:</span>
                  <input
                    type="number"
                    min={40}
                    max={240}
                    value={baseBpm}
                    onChange={(e) =>
                      onUpdatePreset({
                        bpm: Math.max(40, Math.min(240, Number(e.target.value) || 100)),
                      })
                    }
                    className="w-20 h-8 px-2 rounded-lg bg-[var(--surface-base)] border border-[var(--surface-border)] font-mono tabular-nums text-xs text-slate-900 dark:text-zinc-100 text-center"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Independent Volume L and Volume R for P2 -> 2x P10 Mono Y-Cable */}
          <div className="pt-2.5 border-t border-[var(--surface-border-subtle)] grid grid-cols-1 gap-2.5">
            {/* Channel L */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-800 dark:text-amber-400 font-mono text-xs font-bold flex items-center justify-center">
                    L
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-zinc-100">
                    {t.live.volumeL}
                  </span>
                  {swapLR && (
                    <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400">→ R</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-slate-700 dark:text-zinc-200 w-10 text-right">
                    {Math.round(volL * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={toggleMuteL}
                    className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 cursor-pointer ${
                      volL <= 0.01
                        ? 'bg-rose-500/15 dark:bg-rose-500/20 border-rose-500/50 text-rose-700 dark:text-rose-300'
                        : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-700 dark:text-zinc-300'
                    }`}
                  >
                    {volL <= 0.01 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    <span>{volL <= 0.01 ? t.live.mute : 'On'}</span>
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={volL}
                onChange={(e) => onUpdatePreset({ volumeL: parseFloat(e.target.value) })}
                className="studio-slider w-full"
              />
            </div>

            {/* Channel R */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-[var(--surface-border-subtle)]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-800 dark:text-emerald-400 font-mono text-xs font-bold flex items-center justify-center">
                    R
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-zinc-100">
                    {t.live.volumeR}
                  </span>
                  {swapLR && (
                    <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400">→ L</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-slate-700 dark:text-zinc-200 w-10 text-right">
                    {Math.round(volR * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={toggleMuteR}
                    className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 cursor-pointer ${
                      volR <= 0.01
                        ? 'bg-rose-500/15 dark:bg-rose-500/20 border-rose-500/50 text-rose-700 dark:text-rose-300'
                        : 'bg-[var(--surface-control)] border-[var(--surface-border)] text-slate-700 dark:text-zinc-300'
                    }`}
                  >
                    {volR <= 0.01 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    <span>{volR <= 0.01 ? t.live.mute : 'On'}</span>
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={volR}
                onChange={(e) => onUpdatePreset({ volumeR: parseFloat(e.target.value) })}
                className="studio-slider w-full"
              />
            </div>
          </div>
        </section>
      </div>
    );
  }
);

LiveControlsPanel.displayName = 'LiveControlsPanel';
