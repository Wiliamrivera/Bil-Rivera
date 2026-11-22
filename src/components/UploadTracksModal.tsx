import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderSync,
  Info,
  Layers,
  Loader2,
  Music2,
  Send,
  Upload,
  X,
} from 'lucide-react';
import { TranslationDict } from '../i18n/translations';
import {
  loadLastDirHandle,
  loadLastFolderName,
  saveLastDirHandle,
  saveLastFolderName,
} from '../storage/studioStorage';
import {
  isAndroidDevice,
  isHandheldOrTablet,
  isIOSOrIPadOS,
} from '../utils/platform';

interface DirectoryHandleEntry {
  kind: 'file' | 'directory';
  name: string;
  getFile?: () => Promise<File>;
  values?: () => AsyncIterable<DirectoryHandleEntry>;
}

interface DirectoryHandleLike extends DirectoryHandleEntry {
  kind: 'directory';
  queryPermission?: (desc?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (desc?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  values: () => AsyncIterable<DirectoryHandleEntry>;
}

interface VirtualFolderNode {
  name: string;
  files: File[];
  children: Map<string, VirtualFolderNode>;
}

interface SubfolderItem {
  name: string;
  handle?: DirectoryHandleLike;
  virtualNode?: VirtualFolderNode;
}

export interface UploadTracksModalHandle {
  openAddMusicPicker: (options?: { isNewPlaylist?: boolean }) => void;
}

const AUDIO_EXT_RE = /\.(mp3|wav|m4a|m4b|mp4|ogg|oga|opus|flac|aac|webm|wma|aiff|aif|caf|mpeg|mp2|3gp|amr)$/i;
const DESKTOP_AUDIO_ACCEPT =
  'audio/*,.mp3,.wav,.m4a,.m4b,.mp4,.ogg,.oga,.flac,.aac,.opus,.webm,.wma,.aiff,.aif,.caf,.mpeg,.mp2,.3gp,.amr';

function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXT_RE.test(file.name);
}

function getFileExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toUpperCase() : 'AUDIO';
}

function buildVirtualTree(files: File[], rootLabel: string): VirtualFolderNode {
  const root: VirtualFolderNode = { name: rootLabel, files: [], children: new Map() };
  for (const file of files) {
    if (!isAudioFile(file)) continue;
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    const parts = rel ? rel.split('/').filter(Boolean) : [file.name];
    const innerParts = parts.length > 1 && parts[0] === rootLabel ? parts.slice(1) : parts;
    let cursor = root;
    for (let i = 0; i < innerParts.length - 1; i++) {
      const seg = innerParts[i];
      let child = cursor.children.get(seg);
      if (!child) {
        child = { name: seg, files: [], children: new Map() };
        cursor.children.set(seg, child);
      }
      cursor = child;
    }
    cursor.files.push(file);
  }
  return root;
}

function collectVirtualFilesRecursive(node: VirtualFolderNode): File[] {
  const out = [...node.files];
  for (const child of node.children.values()) {
    out.push(...collectVirtualFilesRecursive(child));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

async function collectHandleFilesRecursive(handle: DirectoryHandleLike, depth = 0): Promise<File[]> {
  if (depth > 6) return [];
  const out: File[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === 'file' && entry.getFile) {
      const f = await entry.getFile();
      if (isAudioFile(f)) out.push(f);
    } else if (entry.kind === 'directory' && entry.values) {
      const sub = await collectHandleFilesRecursive(entry as DirectoryHandleLike, depth + 1);
      out.push(...sub);
    }
  }
  return out;
}

// Device detection helpers imported from ../utils/platform

interface UploadTracksModalProps {
  open: boolean;
  t: TranslationDict;
  existingTitles: string[];
  isImporting: boolean;
  onRequestOpen?: () => void;
  onClose: () => void;
  onPreparingImport?: (count?: number) => void;
  onImportEmpty?: (message: string) => void;
  onImportFiles: (files: File[] | FileList) => Promise<void> | void;
}

export const UploadTracksModal = memo(forwardRef<UploadTracksModalHandle, UploadTracksModalProps>(
  (
    {
      open,
      t,
      existingTitles,
      isImporting,
      onRequestOpen,
      onClose,
      onPreparingImport,
      onImportEmpty,
      onImportFiles,
    },
    ref
  ) => {
    const [savedHandle, setSavedHandle] = useState<DirectoryHandleLike | null>(null);
    const [lastFolderName, setLastFolderName] = useState<string>(() => loadLastFolderName());

    const [handleStack, setHandleStack] = useState<DirectoryHandleLike[]>([]);
    const [virtualStack, setVirtualStack] = useState<VirtualFolderNode[]>([]);
    const [subfolders, setSubfolders] = useState<SubfolderItem[]>([]);
    const [folderFiles, setFolderFiles] = useState<File[] | null>(null);
    const [activeFolderLabel, setActiveFolderLabel] = useState<string>('');
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

    const [isScanningFolder, setIsScanningFolder] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const folderInputRef = useRef<HTMLInputElement | null>(null);
    const onImportFilesRef = useRef(onImportFiles);
    onImportFilesRef.current = onImportFiles;

    const isMobile = useMemo(() => isHandheldOrTablet(), []);
    const isAndroid = useMemo(() => isAndroidDevice(), []);
    const isIOS = useMemo(() => isIOSOrIPadOS(), []);

    const supportsDirectoryPicker =
      typeof window !== 'undefined' && 'showDirectoryPicker' in window;
    const isTopLevelWindow =
      typeof window !== 'undefined' && window.self === window.top;
    const canUseNativeDirectoryPicker = supportsDirectoryPicker && isTopLevelWindow;
    const supportsOpenFilePicker =
      typeof window !== 'undefined' && 'showOpenFilePicker' in window && isTopLevelWindow;
    const supportsWebkitDirectory = useMemo(() => {
      if (typeof document === 'undefined' || isIOS) return false;
      const input = document.createElement('input');
      return 'webkitdirectory' in input;
    }, [isIOS]);

    const existingTitleSet = useMemo(
      () => new Set(existingTitles.map((title) => title.trim().toLowerCase())),
      [existingTitles]
    );

    useEffect(() => {
      if (!open) {
        setFolderFiles(null);
        setSubfolders([]);
        setHandleStack([]);
        setVirtualStack([]);
        setSelectedIndices(new Set());
        setErrorMessage(null);
        return;
      }
      let cancelled = false;
      setLastFolderName(loadLastFolderName());
      loadLastDirHandle<DirectoryHandleLike>()
        .then((h) => {
          if (!cancelled && h) {
            setSavedHandle(h);
            if (h.name) {
              setLastFolderName(h.name);
              saveLastFolderName(h.name);
            }
          }
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [open]);

    const populateListView = (
      files: File[],
      dirs: SubfolderItem[],
      label: string
    ) => {
      const audioOnly = files
        .filter(isAudioFile)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

      const sortedDirs = [...dirs].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      );

      setActiveFolderLabel(label);
      setSubfolders(sortedDirs);
      setFolderFiles(audioOnly);
      setErrorMessage(null);
      // Start unchecked so user can select 1-by-1; after clicking the 1st song,
      // "Selecionar todas" and "Adicionar selecionadas ao app" unlock immediately.
      setSelectedIndices(new Set());

      if (label && sortedDirs.length + audioOnly.length > 0 && label !== t.uploadModal.pickedTitle) {
        setLastFolderName(label);
        saveLastFolderName(label);
      }

      onRequestOpen?.();
    };

    const openDirectoryHandle = async (handle: DirectoryHandleLike, nextStack: DirectoryHandleLike[]) => {
      setIsScanningFolder(true);
      setErrorMessage(null);
      try {
        let perm = handle.queryPermission ? await handle.queryPermission({ mode: 'read' }) : 'granted';
        if (perm !== 'granted' && handle.requestPermission) {
          perm = await handle.requestPermission({ mode: 'read' });
        }
        if (perm !== 'granted') return;

        const list: File[] = [];
        const dirs: SubfolderItem[] = [];
        for await (const entry of handle.values()) {
          if (entry.kind === 'directory' && entry.values) {
            dirs.push({ name: entry.name, handle: entry as DirectoryHandleLike });
          } else if (entry.kind === 'file' && entry.getFile) {
            try {
              const f = await entry.getFile();
              if (isAudioFile(f)) list.push(f);
            } catch {
              // skip unreadable file without aborting the folder scan
            }
          }
        }
        await saveLastDirHandle(handle);
        setSavedHandle(handle);
        setHandleStack(nextStack);
        setVirtualStack([]);
        populateListView(list, dirs, nextStack.map((h) => h.name).filter(Boolean).join(' / '));
      } catch (err) {
        const errName = (err as { name?: string })?.name;
        if (errName === 'SecurityError' || errName === 'NotAllowedError') {
          setErrorMessage(t.uploadModal.rootSecurityError);
          onRequestOpen?.();
        } else {
          console.warn('Could not read directory handle:', err);
        }
      } finally {
        setIsScanningFolder(false);
      }
    };

    const openVirtualNode = (node: VirtualFolderNode, nextStack: VirtualFolderNode[]) => {
      const dirs: SubfolderItem[] = Array.from(node.children.values()).map((child) => ({
        name: child.name,
        virtualNode: child,
      }));
      setVirtualStack(nextStack);
      setHandleStack([]);
      populateListView(node.files, dirs, nextStack.map((n) => n.name).filter(Boolean).join(' / '));
    };

    const handlePickFiles = async (options?: { isNewPlaylist?: boolean }) => {
      setErrorMessage(null);
      if (supportsOpenFilePicker) {
        try {
          const picker = (window as unknown as {
            showOpenFilePicker: (opts?: {
              id?: string;
              multiple?: boolean;
              startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
              types?: Array<{ description?: string; accept: Record<string, string[]> }>;
            }) => Promise<Array<{ getFile: () => Promise<File> }>>;
          }).showOpenFilePicker;

          // New playlist: Desktop starts in Documents, Mobile opens root/main folder.
          // Upload Música / existing playlist: remember last folder automatically on both Android and Desktop.
          const handles = await picker({
            multiple: true,
            ...(options?.isNewPlaylist
              ? isMobile
                ? {}
                : { startIn: 'documents' }
              : isMobile
                ? { id: 'rivera-mobile-files' }
                : { id: 'rivera-desktop-files', startIn: 'documents' }),
            types: [
              {
                description: 'Audio Files',
                accept: {
                  'audio/*': [
                    '.mp3',
                    '.wav',
                    '.m4a',
                    '.m4b',
                    '.mp4',
                    '.ogg',
                    '.oga',
                    '.flac',
                    '.aac',
                    '.opus',
                    '.webm',
                    '.wma',
                    '.aiff',
                    '.aif',
                    '.caf',
                    '.mpeg',
                    '.mp2',
                    '.3gp',
                    '.amr',
                  ],
                },
              },
            ],
          });

          if (handles.length === 0) return;

          // Immediately show circular loading indicator before reading large handle batches
          onPreparingImport?.(handles.length);
          onClose();
          await new Promise<void>((r) => window.setTimeout(r, 0));

          const resolvedFiles: File[] = [];
          const chunkSize = 10;
          for (let i = 0; i < handles.length; i += chunkSize) {
            const slice = handles.slice(i, i + chunkSize);
            const settled = await Promise.allSettled(slice.map((h) => h.getFile()));
            for (const item of settled) {
              if (item.status === 'fulfilled' && item.value) {
                resolvedFiles.push(item.value);
              }
            }
          }

          const audioOnly = resolvedFiles.filter(isAudioFile);
          if (audioOnly.length > 0) {
            await onImportFilesRef.current(audioOnly);
          } else {
            onImportEmpty?.(t.uploadModal.uploadEmptyError);
          }
          return;
        } catch (err) {
          const name = (err as { name?: string })?.name;
          if (name === 'AbortError') return;
        }
      }
      fileInputRef.current?.click();
    };

    const handlePickFolder = async () => {
      setErrorMessage(null);
      if (canUseNativeDirectoryPicker) {
        try {
          const picker = (window as unknown as {
            showDirectoryPicker: (opts?: {
              startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
              mode?: 'read' | 'readwrite';
            }) => Promise<DirectoryHandleLike>;
          }).showDirectoryPicker;
          const handle = await picker(
            isMobile ? { mode: 'read' } : { startIn: 'documents', mode: 'read' }
          );
          await openDirectoryHandle(handle, [handle]);
          return;
        } catch (err) {
          const name = (err as { name?: string })?.name;
          if (name === 'AbortError') return;
          if (name === 'SecurityError' || name === 'NotAllowedError') {
            setErrorMessage(t.uploadModal.rootSecurityError);
            onRequestOpen?.();
            return;
          }
        }
      }

      if (supportsWebkitDirectory) {
        folderInputRef.current?.click();
        return;
      }

      fileInputRef.current?.click();
    };

    useImperativeHandle(ref, () => ({
      openAddMusicPicker: (options?: { isNewPlaylist?: boolean }) => {
        void handlePickFiles(options);
      },
    }));

    const handleScanSubfolders = async () => {
      setIsScanningFolder(true);
      setErrorMessage(null);
      try {
        if (handleStack.length > 0) {
          const currentHandle = handleStack[handleStack.length - 1];
          const allFiles = await collectHandleFilesRecursive(currentHandle);
          populateListView(allFiles, [], `${activeFolderLabel} (+ ${t.uploadModal.folderTag})`);
        } else if (virtualStack.length > 0) {
          const currentNode = virtualStack[virtualStack.length - 1];
          const allFiles = collectVirtualFilesRecursive(currentNode);
          populateListView(allFiles, [], `${activeFolderLabel} (+ ${t.uploadModal.folderTag})`);
        }
      } catch (err) {
        const errName = (err as { name?: string })?.name;
        if (errName === 'SecurityError' || errName === 'NotAllowedError') {
          setErrorMessage(t.uploadModal.rootSecurityError);
        } else {
          console.warn('Could not scan subfolders:', err);
          setErrorMessage(t.uploadModal.uploadEmptyError);
        }
      } finally {
        setIsScanningFolder(false);
      }
    };

    const canGoBackFolder = handleStack.length > 1 || virtualStack.length > 1;

    const handleGoBackFolder = async () => {
      if (handleStack.length > 1) {
        const nextStack = handleStack.slice(0, -1);
        await openDirectoryHandle(nextStack[nextStack.length - 1], nextStack);
      } else if (virtualStack.length > 1) {
        const nextStack = virtualStack.slice(0, -1);
        openVirtualNode(nextStack[nextStack.length - 1], nextStack);
      }
    };

    const handleResetToSourcePicker = () => {
      setFolderFiles(null);
      setSubfolders([]);
      setHandleStack([]);
      setVirtualStack([]);
      setSelectedIndices(new Set());
      setErrorMessage(null);
    };

    const allSelected =
      Boolean(folderFiles && folderFiles.length > 0 && selectedIndices.size === folderFiles.length);

    const toggleAllChecklist = () => {
      if (!folderFiles) return;
      if (allSelected) {
        setSelectedIndices(new Set());
      } else {
        setSelectedIndices(new Set(folderFiles.map((_, idx) => idx)));
      }
    };

    const toggleIndex = (idx: number) => {
      setSelectedIndices((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
    };

    const handleSendSelected = async () => {
      if (!folderFiles || isImporting) return;
      const chosen = folderFiles.filter((_, idx) => selectedIndices.has(idx));
      if (chosen.length === 0) return;
      onPreparingImport?.(chosen.length);
      onClose();
      await new Promise<void>((r) => window.setTimeout(r, 0));
      try {
        await onImportFilesRef.current(chosen);
      } catch (err) {
        console.warn('Failed to import selected tracks:', err);
        onImportEmpty?.(t.uploadModal.uploadEmptyError);
      }
    };

    const hiddenInputs = (
      <>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={isAndroid ? undefined : DESKTOP_AUDIO_ACCEPT}
          className="hidden"
          onChange={async (e) => {
            const inputEl = e.currentTarget;
            const files = inputEl.files ? Array.from(inputEl.files) : [];
            if (files.length === 0) return;

            onPreparingImport?.(files.length);
            onClose();
            await new Promise<void>((r) => window.setTimeout(r, 0));

            try {
              const audioOnly = files.filter(isAudioFile);
              if (audioOnly.length > 0) {
                await onImportFilesRef.current(audioOnly);
              } else {
                onImportEmpty?.(t.uploadModal.uploadEmptyError);
              }
            } finally {
              inputEl.value = '';
            }
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error webkitdirectory is supported on Chromium/WebKit browsers
          webkitdirectory=""
          className="hidden"
          onChange={(e) => {
            const inputEl = e.currentTarget;
            const files = inputEl.files ? Array.from(inputEl.files) : [];
            inputEl.value = '';
            if (files.length > 0) {
              const rel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
              const rootName = rel.includes('/') ? rel.split('/')[0] : t.uploadModal.folderTag;
              const tree = buildVirtualTree(files, rootName);
              openVirtualNode(tree, [tree]);
            }
          }}
        />
      </>
    );

    if (!open) return hiddenInputs;

    return (
      <>
        {hiddenInputs}
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          onClick={onClose}
        >
          <div
            className="w-full max-w-md bg-[var(--surface-card)] border border-[var(--surface-border-subtle)] rounded-2xl p-4 sm:p-5 flex flex-col gap-3 shadow-2xl max-h-[88dvh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
                  <Upload className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-zinc-100 truncate">
                    {t.uploadModal.title}
                  </h3>
                  {folderFiles !== null ? (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium truncate">
                      {activeFolderLabel || t.uploadModal.pickedTitle}
                    </p>
                  ) : lastFolderName ? (
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                      {t.uploadModal.lastFolderLabel}: <span className="text-amber-700 dark:text-amber-400 font-medium">{lastFolderName}</span>
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t.pwa.close}
                className="w-8 h-8 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-200 leading-relaxed shrink-0">
                {errorMessage}
              </div>
            )}

            {folderFiles === null ? (
              <div className="flex flex-col gap-2.5 overflow-y-auto min-h-0 pr-0.5">
                {savedHandle && (
                  <button
                    type="button"
                    onClick={() => openDirectoryHandle(savedHandle, [savedHandle])}
                    disabled={isScanningFolder}
                    className="min-h-[48px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer shrink-0"
                  >
                    {isScanningFolder ? (
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                    ) : (
                      <FolderSync className="w-4 h-4 shrink-0" />
                    )}
                    <span className="truncate">
                      {isScanningFolder
                        ? t.uploadModal.scanning
                        : `${t.uploadModal.openLastFolder}${savedHandle.name ? `: ${savedHandle.name}` : ''}`}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handlePickFiles()}
                  disabled={isImporting}
                  className={`min-h-[48px] px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-pointer shrink-0 ${
                    savedHandle
                      ? 'bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-amber-500/60 text-slate-900 dark:text-zinc-100'
                      : 'bg-amber-500 hover:bg-amber-400 text-[var(--accent-fg)]'
                  }`}
                >
                  {isImporting ? (
                    <Loader2 className={`w-4 h-4 shrink-0 animate-spin ${savedHandle ? 'text-amber-700 dark:text-amber-400' : ''}`} />
                  ) : (
                    <Music2 className={`w-4 h-4 shrink-0 ${savedHandle ? 'text-amber-700 dark:text-amber-400' : ''}`} />
                  )}
                  <span>{isImporting ? t.uploadModal.uploadingShort : t.uploadModal.pickFiles}</span>
                </button>

                {(canUseNativeDirectoryPicker || supportsWebkitDirectory) && (
                  <button
                    type="button"
                    onClick={handlePickFolder}
                    disabled={isScanningFolder}
                    className="min-h-[44px] px-4 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-amber-500/60 text-slate-800 dark:text-zinc-200 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer shrink-0"
                  >
                    {isScanningFolder ? (
                      <Loader2 className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-400 animate-spin" />
                    ) : (
                      <FolderOpen className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-400" />
                    )}
                    <span>
                      {isScanningFolder
                        ? t.uploadModal.scanning
                        : isMobile
                          ? t.uploadModal.pickFolder
                          : t.uploadModal.pickDocumentsFolder}
                    </span>
                  </button>
                )}

                <div className="mt-0.5 p-3 rounded-xl bg-[var(--surface-base)] border border-[var(--surface-border-subtle)] flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">
                    {isIOS
                      ? t.uploadModal.iosHint
                      : isAndroid
                        ? t.uploadModal.androidHint
                        : t.uploadModal.desktopHint}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 min-h-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--surface-border-subtle)] shrink-0">
                  <div className="flex items-center gap-1.5">
                    {canGoBackFolder && (
                      <button
                        type="button"
                        onClick={handleGoBackFolder}
                        disabled={isScanningFolder}
                        className="min-h-[34px] px-2.5 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-amber-500/50 text-xs font-semibold text-slate-800 dark:text-zinc-200 flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                        <span>{t.uploadModal.backFolder}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleResetToSourcePicker}
                      className="min-h-[34px] px-2.5 rounded-lg bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-slate-400 dark:hover:border-zinc-500 text-xs font-medium text-slate-700 dark:text-zinc-300 flex items-center gap-1.5 cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                      <span>{t.uploadModal.changeFolder}</span>
                    </button>
                  </div>

                  {/* Show "Selecionar todas" once the user clicks the 1st song */}
                  {folderFiles.length > 0 && selectedIndices.size > 0 && (
                    <button
                      type="button"
                      onClick={toggleAllChecklist}
                      className="min-h-[34px] px-3 rounded-lg bg-amber-500/15 border border-amber-500/40 hover:bg-amber-500/25 text-xs font-semibold text-amber-800 dark:text-amber-300 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {allSelected ? t.uploadModal.deselectAll : t.uploadModal.selectAll}
                    </button>
                  )}
                </div>

                {folderFiles.length > 0 && selectedIndices.size === 0 && (
                  <p className="text-[11px] text-amber-800 dark:text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 shrink-0">
                    {t.uploadModal.tapFirstHint}
                  </p>
                )}

                {subfolders.length > 0 && (handleStack.length > 0 || virtualStack.length > 0) && (
                  <button
                    type="button"
                    onClick={handleScanSubfolders}
                    disabled={isScanningFolder}
                    className="min-h-[38px] px-3 rounded-xl bg-[var(--surface-control)] border border-[var(--surface-border)] hover:border-amber-500/50 text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                  >
                    {isScanningFolder ? (
                      <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                    ) : (
                      <Layers className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>{isScanningFolder ? t.uploadModal.scanning : t.uploadModal.scanSubfolders}</span>
                  </button>
                )}

                <div className="flex flex-col divide-y divide-[var(--surface-border-subtle)] rounded-xl border border-[var(--surface-border-subtle)] bg-[var(--surface-base)] overflow-y-auto min-h-0 flex-1">
                  {subfolders.map((dir) => (
                    <button
                      key={`dir-${dir.name}`}
                      type="button"
                      disabled={isScanningFolder}
                      onClick={async () => {
                        if (dir.handle) {
                          await openDirectoryHandle(dir.handle, [...handleStack, dir.handle]);
                        } else if (dir.virtualNode) {
                          openVirtualNode(dir.virtualNode, [...virtualStack, dir.virtualNode]);
                        }
                      }}
                      className="w-full min-h-[48px] px-3 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-[var(--surface-control)] cursor-pointer shrink-0"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
                          <Folder className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">{dir.name}</p>
                          <p className="text-[11px] text-slate-500 dark:text-zinc-400">{t.uploadModal.folderTag}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 dark:text-zinc-400 shrink-0" />
                    </button>
                  ))}

                  {folderFiles.map((file, idx) => {
                    const checked = selectedIndices.has(idx);
                    const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
                    const alreadyInApp = existingTitleSet.has(cleanTitle.trim().toLowerCase());
                    return (
                      <button
                        key={`${file.name}-${file.size}-${idx}`}
                        type="button"
                        onClick={() => toggleIndex(idx)}
                        className={`w-full min-h-[50px] px-3 py-2.5 flex items-center gap-3 text-left transition-colors cursor-pointer shrink-0 ${
                          checked ? 'bg-amber-500/10 hover:bg-amber-500/15' : 'hover:bg-[var(--surface-control)]/70'
                        }`}
                      >
                        <span
                          className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                            checked
                              ? 'bg-amber-500 border-amber-500 text-[var(--accent-fg)]'
                              : 'bg-[var(--surface-card)] border-[var(--surface-border)]'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">{cleanTitle}</p>
                          <p className="text-[11px] font-mono text-slate-500 dark:text-zinc-400">
                            {getFileExt(file.name)} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                          </p>
                        </div>
                        {alreadyInApp && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 shrink-0">
                            {t.uploadModal.alreadyImported}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {subfolders.length === 0 && folderFiles.length === 0 && (
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 py-8 px-4 text-center">
                      {t.uploadModal.emptyFolder}
                    </p>
                  )}
                </div>

                {/* Show "Adicionar selecionadas ao app" once at least 1 song is clicked */}
                {selectedIndices.size > 0 && (
                  <div className="pt-2 border-t border-[var(--surface-border-subtle)] shrink-0">
                    <button
                      type="button"
                      disabled={isImporting}
                      onClick={handleSendSelected}
                      className="w-full min-h-[48px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-[var(--accent-fg)] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] transition-transform"
                    >
                      {isImporting ? (
                        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 shrink-0" />
                      )}
                      <span>
                        {isImporting
                          ? t.uploadModal.uploadingShort
                          : `${t.uploadModal.importSelected} (${selectedIndices.size})`}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }
));

UploadTracksModal.displayName = 'UploadTracksModal';
