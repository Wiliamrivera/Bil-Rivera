import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  Loader2,
  Pencil,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { ReadyExportData } from '../hooks/useAudioExport';
import { ImportStatusState } from '../hooks/useTrackImporter';
import { TranslationDict } from '../i18n/translations';
import { PracticeTrack } from '../types/studio';

interface StudioModalsProps {
  t: TranslationDict;
  isMobileClient: boolean;
  pendingDeleteTrack: PracticeTrack | null;
  onCancelDelete: () => void;
  onConfirmDelete: (trackId: string) => Promise<void>;
  pendingRenameTrack: PracticeTrack | null;
  renameTitleInput: string;
  onRenameInputChange: (value: string) => void;
  onCancelRename: () => void;
  onConfirmRename: () => void;
  readyExport: ReadyExportData | null;
  canShareExportFile: boolean;
  onClearReadyExport: () => void;
  onShareExport: () => Promise<void>;
  onChooseSaveLocation: () => Promise<void>;
  onTriggerDirectDownload: (exp: { url: string; fileName: string }) => void;
  onScheduleExportCleanup: (delayMs: number) => void;
  isImporting: boolean;
  importStatus: ImportStatusState | null;
  importSuccessCount: number | null;
  importErrorNotice: string | null;
  exportSuccessNotice: string | null;
  showExitNotice: boolean;
}

export const StudioModals: React.FC<StudioModalsProps> = React.memo(
  ({
    t,
    isMobileClient,
    pendingDeleteTrack,
    onCancelDelete,
    onConfirmDelete,
    pendingRenameTrack,
    renameTitleInput,
    onRenameInputChange,
    onCancelRename,
    onConfirmRename,
    readyExport,
    canShareExportFile,
    onClearReadyExport,
    onShareExport,
    onChooseSaveLocation,
    onTriggerDirectDownload,
    onScheduleExportCleanup,
    isImporting,
    importStatus,
    importSuccessCount,
    importErrorNotice,
    exportSuccessNotice,
    showExitNotice,
  }) => {
    return (
      <>
        {/* Delete Track Confirmation Modal */}
        {pendingDeleteTrack && (
          <div
            className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onCancelDelete}
          >
            <div
              className="w-full max-w-sm bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-2xl p-5 flex flex-col gap-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-zinc-100">
                    {t.live.deleteTrackTitle}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-zinc-300 mt-1">
                    {t.live.deleteTrackConfirm}
                  </p>
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 truncate mt-1.5">
                    {pendingDeleteTrack.title}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onCancelDelete}
                  className="min-h-[44px] px-4 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] text-sm font-semibold text-slate-800 dark:text-zinc-200 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
                >
                  {t.live.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const idToDelete = pendingDeleteTrack.id;
                    onCancelDelete();
                    void onConfirmDelete(idToDelete);
                  }}
                  className="min-h-[44px] px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold cursor-pointer"
                >
                  {t.live.confirmDelete}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rename Track Modal */}
        {pendingRenameTrack && (
          <div
            className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onCancelRename}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onConfirmRename();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-2xl p-5 flex flex-col gap-4 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
                    <Pencil className="w-4 h-4" />
                  </div>
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-zinc-100 truncate">
                    {t.live.renameTrackTitle}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onCancelRename}
                  aria-label={t.live.cancel}
                  className="w-8 h-8 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="rivera-rename-track-input"
                  className="text-xs font-semibold text-slate-600 dark:text-zinc-300"
                >
                  {t.live.renameTrackLabel}
                </label>
                <input
                  id="rivera-rename-track-input"
                  type="text"
                  autoFocus
                  value={renameTitleInput}
                  onChange={(e) => onRenameInputChange(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      onCancelRename();
                    }
                  }}
                  placeholder={t.live.renameTrackPlaceholder}
                  maxLength={120}
                  className="w-full h-11 px-3 rounded-xl bg-[var(--surface-base)] border border-[var(--surface-border)] focus:border-amber-500 focus:outline-none text-sm font-medium text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onCancelRename}
                  className="min-h-[44px] px-4 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] text-sm font-semibold text-slate-800 dark:text-zinc-200 hover:border-slate-400 dark:hover:border-zinc-500 cursor-pointer"
                >
                  {t.live.cancel}
                </button>
                <button
                  type="submit"
                  disabled={!renameTitleInput.trim()}
                  className="min-h-[44px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-[var(--accent-fg)] text-sm font-bold cursor-pointer"
                >
                  {t.live.saveRename}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Export Ready Save As Modal */}
        {readyExport && (
          <div
            className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClearReadyExport}
          >
            <div
              className="w-full max-w-sm bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-2xl p-5 flex flex-col gap-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-zinc-100">
                    {t.saveModalTitle}
                  </h3>
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 truncate mt-1">
                    {readyExport.fileName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClearReadyExport}
                  aria-label={t.pwa.close}
                  className="w-8 h-8 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-2.5">
                {isMobileClient ? (
                  <>
                    {canShareExportFile && (
                      <button
                        type="button"
                        onClick={() => void onShareExport()}
                        className="min-h-[46px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer text-center"
                      >
                        <Share2 className="w-4 h-4 shrink-0" />
                        <span>{t.saveShareApps}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void onChooseSaveLocation()}
                      className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer ${
                        canShareExportFile
                          ? 'bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-slate-400 dark:hover:border-zinc-500 text-slate-900 dark:text-zinc-100'
                          : 'bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] font-bold'
                      }`}
                    >
                      <Download
                        className={`w-4 h-4 shrink-0 ${
                          canShareExportFile ? 'text-amber-700 dark:text-amber-400' : ''
                        }`}
                      />
                      <span>{t.saveDirectDownload}</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void onChooseSaveLocation()}
                      className="min-h-[46px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <FolderOpen className="w-4 h-4 shrink-0" />
                      <span>{t.saveChooseFolder}</span>
                    </button>

                    {canShareExportFile && (
                      <button
                        type="button"
                        onClick={() => void onShareExport()}
                        className="min-h-[44px] px-4 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-amber-500/60 text-slate-900 dark:text-zinc-100 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Share2 className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-400" />
                        <span>{t.saveShareApps}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        onTriggerDirectDownload(readyExport);
                        onScheduleExportCleanup(1500);
                      }}
                      className="min-h-[44px] px-4 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-slate-400 dark:hover:border-zinc-500 text-slate-900 dark:text-zinc-100 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Download className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-400" />
                      <span>{t.saveDirectDownload}</span>
                    </button>
                  </>
                )}
              </div>

              <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">
                {t.saveChromeHint}
              </p>
            </div>
          </div>
        )}

        {/* Floating Upload / Export / Error Status Banner */}
        {(isImporting || importSuccessCount !== null || importErrorNotice !== null || exportSuccessNotice !== null) && (
          <div className="fixed top-[max(5rem,calc(env(safe-area-inset-top)+4rem))] left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-24px)] max-w-sm pointer-events-none">
            {isImporting ? (
              <div className="bg-[var(--surface-card-translucent)] backdrop-blur-md border border-amber-500/60 rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3">
                <Loader2 className="w-6 h-6 text-amber-600 dark:text-amber-400 animate-spin shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-zinc-100">
                      {t.uploadModal.uploadingTitle}
                    </span>
                    {importStatus && importStatus.total > 0 && (
                      <span className="text-[11px] font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400 shrink-0">
                        {importStatus.current} / {importStatus.total}
                      </span>
                    )}
                  </div>
                  {importStatus && (
                    <>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                        {importStatus.fileName}
                      </p>
                      {importStatus.total > 0 && (
                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-[var(--surface-base)] overflow-hidden border border-[var(--surface-border)]">
                          <div
                            className="h-full bg-amber-500 transition-all duration-200"
                            style={{
                              width: `${Math.round(
                                (importStatus.current / Math.max(1, importStatus.total)) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : importSuccessCount !== null ? (
              <div className="bg-[var(--surface-card-translucent)] backdrop-blur-md border border-emerald-500/60 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                  {importSuccessCount} · {t.uploadModal.uploadSuccess}
                </span>
              </div>
            ) : exportSuccessNotice !== null ? (
              <div className="bg-[var(--surface-card-translucent)] backdrop-blur-md border border-emerald-500/60 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                  {exportSuccessNotice}
                </span>
              </div>
            ) : (
              <div className="bg-[var(--surface-card-translucent)] backdrop-blur-md border border-rose-500/60 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-2.5">
                <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                <span className="text-xs font-medium text-rose-800 dark:text-rose-100 leading-snug">
                  {importErrorNotice}
                </span>
              </div>
            )}
          </div>
        )}

        {showExitNotice && (
          <div className="fixed bottom-[max(5rem,calc(env(safe-area-inset-bottom)+1.5rem))] sm:bottom-6 left-1/2 -translate-x-1/2 z-[65] w-max max-w-[calc(100%-32px)] pointer-events-none">
            <div className="bg-slate-900/95 dark:bg-[var(--surface-control)]/95 text-white dark:text-zinc-100 border border-slate-700 dark:border-amber-500/40 rounded-xl px-4 py-2.5 shadow-2xl text-xs sm:text-sm font-medium text-center">
              {t.live.exitBackPrompt}
            </div>
          </div>
        )}
      </>
    );
  }
);

StudioModals.displayName = 'StudioModals';
