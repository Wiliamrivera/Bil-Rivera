import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  FolderPlus,
  ListMusic,
  Loader2,
  Play,
  Plus,
  Trash2,
  Undo2,
  Volume2,
  X,
} from 'lucide-react';
import { formatTimecode } from '../audio/audioUtils';
import { TranslationDict } from '../i18n/translations';
import { PracticeTrack, Setlist } from '../types/studio';

interface SetlistsViewProps {
  t: TranslationDict;
  tracks: PracticeTrack[];
  setlists: Setlist[];
  activeTrackId: string;
  isPlaying?: boolean;
  isImporting: boolean;
  onSelectTrack: (trackId: string) => void;
  onSelectSetlist: (setlistId: string) => void;
  onCreateSetlist: (name: string) => void;
  onDeleteSetlist: (setlistId: string) => void;
  onToggleTrackInSetlist: (setlistId: string, trackId: string) => void;
  onMoveTrackInSetlist: (setlistId: string, trackId: string, dir: -1 | 1) => void;
  onSortSetlistAlphabetical: (setlistId: string) => void;
  onResetSetlistOrder: (setlistId: string) => void;
  onOpenUploadModal?: (isNewPlaylist?: boolean) => void;
  onPrewarmTrack?: (trackId: string) => void;
  onPrefetchTracks?: (trackIds: string[]) => () => void;
}

export const SetlistsView: React.FC<SetlistsViewProps> = React.memo(({
  t,
  tracks,
  setlists,
  activeTrackId,
  isPlaying = false,
  isImporting,
  onSelectTrack,
  onSelectSetlist,
  onCreateSetlist,
  onDeleteSetlist,
  onToggleTrackInSetlist,
  onMoveTrackInSetlist,
  onSortSetlistAlphabetical,
  onResetSetlistOrder,
  onOpenUploadModal,
  onPrewarmTrack,
  onPrefetchTracks,
}) => {
  const [newName, setNewName] = useState('');
  const [openedPlaylistId, setOpenedPlaylistId] = useState<string | null>(null);

  const openedSetlist = useMemo(
    () => (openedPlaylistId ? setlists.find((s) => s.id === openedPlaylistId) || null : null),
    [openedPlaylistId, setlists]
  );

  const trackMap = useMemo(() => new Map(tracks.map((tr) => [tr.id, tr])), [tracks]);

  const displayedTracks = useMemo(
    () =>
      openedSetlist
        ? openedSetlist.trackIds
            .map((id) => trackMap.get(id))
            .filter((tr): tr is PracticeTrack => Boolean(tr))
        : [],
    [openedSetlist, trackMap]
  );

  useEffect(() => {
    if (!onPrefetchTracks || displayedTracks.length === 0) return;
    return onPrefetchTracks(displayedTracks.slice(0, 10).map((tr) => tr.id));
  }, [displayedTracks, onPrefetchTracks]);

  const isDisplayedAlphabetical =
    displayedTracks.length <= 1 ||
    displayedTracks.every((tr, idx) => {
      if (idx === 0) return true;
      return (
        displayedTracks[idx - 1].title.localeCompare(tr.title, undefined, {
          numeric: true,
          sensitivity: 'base',
        }) <= 0
      );
    });

  const canResetOpenedOrder = Boolean(
    openedSetlist?.previousTrackIds &&
      openedSetlist.previousTrackIds.length > 0 &&
      (openedSetlist.previousTrackIds.length !== openedSetlist.trackIds.length ||
        openedSetlist.previousTrackIds.some((id, idx) => id !== openedSetlist.trackIds[idx]))
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreateSetlist(trimmed);
    setNewName('');
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Top Playlist Card */}
      <aside className="flex flex-col gap-4 bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl p-4 shadow-sm dark:shadow-none">
        <div className="flex items-center justify-center">
          <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100 text-center">{t.setlists.title}</h2>
        </div>

        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t.setlists.createNamePlaceholder}
            className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-[var(--surface-base)] border border-[var(--surface-border)] text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="h-10 px-3.5 rounded-lg bg-amber-500 text-[var(--accent-fg)] font-semibold text-sm flex items-center gap-1.5 hover:bg-amber-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" />
            <span>{t.setlists.newSetlist}</span>
          </button>
        </form>

        {setlists.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-zinc-400 text-center py-2">{t.setlists.noPlaylists}</p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--surface-border-subtle)]">
            {setlists.map((sl) => {
              const isOpened = openedPlaylistId === sl.id;
              return (
                <div
                  key={sl.id}
                  className={`flex items-center justify-between py-2.5 px-3 rounded-lg transition-colors ${
                    isOpened
                      ? 'bg-amber-500/15 dark:bg-[var(--surface-control)] text-amber-800 dark:text-amber-400'
                      : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[var(--surface-control)]/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectSetlist(sl.id);
                      setOpenedPlaylistId((prev) => (prev === sl.id ? null : sl.id));
                    }}
                    className="flex-1 flex items-center gap-2.5 min-w-0 text-left cursor-pointer py-1"
                  >
                    <ListMusic className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-medium truncate">{sl.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (openedPlaylistId === sl.id) {
                        setOpenedPlaylistId(null);
                      }
                      onDeleteSetlist(sl.id);
                    }}
                    title={t.setlists.remove}
                    aria-label={t.setlists.remove}
                    className="ml-2 p-2 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-200/70 dark:hover:bg-[var(--surface-base)]/50 transition-colors cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </aside>

      {/* Selected Playlist Tracks Block — Hidden until user clicks a playlist */}
      {openedSetlist && (
        <section className="flex flex-col gap-4">
          <div className="bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-xl overflow-hidden shadow-sm dark:shadow-none">
            <div className="px-4 py-3.5 border-b border-[var(--surface-border-subtle)] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                  {openedSetlist.name}
                </h3>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-zinc-400 shrink-0">
                  {displayedTracks.length} {t.setlists.tracksCount}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => {
                    onSelectSetlist(openedSetlist.id);
                    onOpenUploadModal?.(openedSetlist.trackIds.length === 0);
                  }}
                  className="min-h-[36px] px-3 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-[var(--accent-fg)] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  {isImporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{isImporting ? t.uploadModal.uploadingShort : t.setlists.addToPlaylist}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOpenedPlaylistId(null)}
                  aria-label={t.setlists.closePicker}
                  className="w-9 h-9 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {displayedTracks.length > 1 && (
              <div className="px-4 py-2 border-b border-[var(--surface-border-subtle)] bg-[var(--surface-base)] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onSortSetlistAlphabetical(openedSetlist.id)}
                  disabled={isDisplayedAlphabetical}
                  className={`min-h-[32px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                    isDisplayedAlphabetical
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-300 cursor-default'
                      : 'bg-white dark:bg-[var(--surface-control)] border-[var(--surface-border)] hover:border-amber-500/60 text-slate-700 dark:text-zinc-200'
                  }`}
                >
                  <ArrowDownAZ className="w-3.5 h-3.5 shrink-0" />
                  <span>{t.setlists.sortAlphabetical}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onResetSetlistOrder(openedSetlist.id)}
                  disabled={!canResetOpenedOrder}
                  title={t.setlists.resetOrderTitle}
                  className="min-h-[32px] px-2.5 rounded-lg border border-[var(--surface-border)] bg-white dark:bg-[var(--surface-control)] hover:border-slate-400 dark:hover:border-zinc-500 disabled:opacity-35 disabled:cursor-not-allowed text-xs font-semibold text-slate-700 dark:text-zinc-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                >
                  <Undo2 className="w-3.5 h-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
                  <span>{t.setlists.resetOrder}</span>
                </button>
              </div>
            )}

            {displayedTracks.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center gap-2">
                <p className="text-sm text-slate-500 dark:text-zinc-400">{t.setlists.emptySetlist}</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--surface-border-subtle)]">
                {displayedTracks.map((track, idx) => {
                  const isCurrent = track.id === activeTrackId;
                  const effBpm = Math.round((track.preset.bpm || 100) * track.preset.speed);
                  const tones = track.preset.pitchSemitones / 2;
                  const pitchTxt =
                    tones === 0
                      ? `0 ${t.live.toneUnit}`
                      : `${tones > 0 ? '+' : ''}${Number.isInteger(tones) ? tones : tones.toFixed(1)} ${t.live.toneUnit}`;

                  return (
                    <div
                      key={track.id}
                      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition-colors ${
                        isCurrent ? 'bg-amber-500/10' : 'hover:bg-slate-50 dark:hover:bg-[var(--surface-control)]/50'
                      }`}
                    >
                      <button
                        type="button"
                        onMouseEnter={() => onPrewarmTrack?.(track.id)}
                        onPointerDown={() => onPrewarmTrack?.(track.id)}
                        onClick={() => onSelectTrack(track.id)}
                        className="flex-1 flex items-center gap-3.5 min-w-0 text-left cursor-pointer"
                      >
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                            isCurrent
                              ? 'bg-amber-500 text-[var(--accent-fg)]'
                              : 'bg-[var(--surface-control)] text-slate-700 dark:text-zinc-300 border border-[var(--surface-border-subtle)]'
                          }`}
                        >
                          {isCurrent && isPlaying ? (
                            <Volume2 className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4 fill-current" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className={`text-sm font-semibold truncate ${isCurrent ? 'text-amber-700 dark:text-amber-400' : 'text-slate-900 dark:text-zinc-100'}`}>
                            {track.title}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-zinc-400 mt-0.5 font-mono tabular-nums">
                            <span>{formatTimecode(track.duration)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{effBpm} BPM</span>
                            <span aria-hidden="true">·</span>
                            <span>{pitchTxt}</span>
                            <span aria-hidden="true">·</span>
                            <span>L {Math.round((track.preset.volumeL ?? 1) * 100)}%</span>
                            <span aria-hidden="true">·</span>
                            <span>R {Math.round((track.preset.volumeR ?? 1) * 100)}%</span>
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onMoveTrackInSetlist(openedSetlist.id, track.id, -1)}
                          disabled={idx === 0}
                          title={t.setlists.moveUp}
                          className="p-2 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-[var(--surface-control)] disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveTrackInSetlist(openedSetlist.id, track.id, 1)}
                          disabled={idx === displayedTracks.length - 1}
                          title={t.setlists.moveDown}
                          className="p-2 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-[var(--surface-control)] disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleTrackInSetlist(openedSetlist.id, track.id)}
                          title={t.setlists.remove}
                          className="p-2 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-[var(--surface-control)] cursor-pointer"
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
        </section>
      )}
    </div>
  );
});
