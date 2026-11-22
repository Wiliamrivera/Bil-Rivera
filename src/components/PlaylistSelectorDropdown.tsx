import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ListMusic, Music2 } from 'lucide-react';
import { TranslationDict } from '../i18n/translations';
import { PracticeTrack, Setlist } from '../types/studio';

interface PlaylistSelectorDropdownProps {
  setlists: Setlist[];
  tracks: PracticeTrack[];
  activeSetlistId: string;
  t: TranslationDict;
  onSelectSetlist: (setlistId: string) => void;
}

export const PlaylistSelectorDropdown: React.FC<PlaylistSelectorDropdownProps> = React.memo(({
  setlists,
  tracks,
  activeSetlistId,
  t,
  onSelectSetlist,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeSetlist =
    activeSetlistId !== 'all' ? setlists.find((sl) => sl.id === activeSetlistId) : undefined;

  useEffect(() => {
    if (!isOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [isOpen]);

  const validTrackIds = useMemo(() => new Set(tracks.map((tr) => tr.id)), [tracks]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className={`w-full min-h-[42px] px-3 rounded-xl bg-[var(--surface-base)] border transition-colors flex items-center justify-between gap-2 text-left cursor-pointer ${
          isOpen
            ? 'border-amber-500'
            : 'border-[var(--surface-border)] hover:border-slate-400 dark:hover:border-zinc-500'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ListMusic className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="font-display text-sm sm:text-base font-semibold text-slate-900 dark:text-zinc-100 truncate">
            {activeSetlist ? activeSetlist.name : t.setlists.allTracks}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 dark:text-zinc-400 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-amber-600 dark:text-amber-400' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="mt-2 rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] overflow-hidden shadow-xl">
          <div className="max-h-64 overflow-y-auto divide-y divide-[var(--surface-border-subtle)]">
            {setlists.map((sl) => {
              const isSelected = activeSetlistId === sl.id;
              const count = sl.trackIds.filter((id) => validTrackIds.has(id)).length;
              return (
                <button
                  key={sl.id}
                  type="button"
                  onClick={() => {
                    onSelectSetlist(sl.id);
                    setIsOpen(false);
                  }}
                  className={`w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-amber-50 dark:bg-[var(--surface-control)] text-amber-800 dark:text-amber-300'
                      : 'text-slate-900 dark:text-zinc-100 hover:bg-slate-50 dark:hover:bg-[var(--surface-control)]/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ListMusic
                      className={`w-4 h-4 shrink-0 ${
                        isSelected
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-500 dark:text-zinc-400'
                      }`}
                    />
                    <span className="text-sm font-medium truncate">{sl.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-zinc-400">
                      {count} {t.setlists.tracksCount}
                    </span>
                    {isSelected && <Check className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
                  </div>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                onSelectSetlist('all');
                setIsOpen(false);
              }}
              className={`w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                activeSetlistId === 'all' || !activeSetlist
                  ? 'bg-amber-50 dark:bg-[var(--surface-control)] text-amber-800 dark:text-amber-300'
                  : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-[var(--surface-control)]/50'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Music2
                  className={`w-4 h-4 shrink-0 ${
                    activeSetlistId === 'all' || !activeSetlist
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-500 dark:text-zinc-400'
                  }`}
                />
                <span className="text-sm font-medium truncate">{t.setlists.allTracks}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-zinc-400">
                  {tracks.length} {t.setlists.tracksCount}
                </span>
                {(activeSetlistId === 'all' || !activeSetlist) && (
                  <Check className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                )}
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
