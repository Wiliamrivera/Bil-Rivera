import { useCallback, useEffect, useRef, useState } from 'react';

interface UseAndroidBackGuardOptions {
  isAtRoot: boolean;
  hasPendingRename: boolean;
  hasPendingDelete: boolean;
  hasReadyExport: boolean;
  showUploadModal: boolean;
  onCloseRename: () => void;
  onCloseDelete: () => void;
  onCloseReadyExport: () => void;
  onCloseUploadModal: () => void;
  onReturnToRoot: () => void;
}

export function useAndroidBackGuard({
  isAtRoot,
  hasPendingRename,
  hasPendingDelete,
  hasReadyExport,
  showUploadModal,
  onCloseRename,
  onCloseDelete,
  onCloseReadyExport,
  onCloseUploadModal,
  onReturnToRoot,
}: UseAndroidBackGuardOptions) {
  const [showExitNotice, setShowExitNotice] = useState(false);

  const exitNoticeTimerRef = useRef<number | null>(null);
  const exitArmedUntilRef = useRef<number>(0);

  const stateRef = useRef({
    isAtRoot,
    hasPendingRename,
    hasPendingDelete,
    hasReadyExport,
    showUploadModal,
    onCloseRename,
    onCloseDelete,
    onCloseReadyExport,
    onCloseUploadModal,
    onReturnToRoot,
  });
  stateRef.current = {
    isAtRoot,
    hasPendingRename,
    hasPendingDelete,
    hasReadyExport,
    showUploadModal,
    onCloseRename,
    onCloseDelete,
    onCloseReadyExport,
    onCloseUploadModal,
    onReturnToRoot,
  };

  const ensureHistoryGuard = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      if (!window.history.state || window.history.state.riveraGuard !== true) {
        window.history.pushState({ riveraGuard: true }, '');
      }
    } catch {
      // ignore restricted history environments
    }
  }, []);

  const clearExitPrompt = useCallback(() => {
    exitArmedUntilRef.current = 0;
    if (exitNoticeTimerRef.current !== null) {
      window.clearTimeout(exitNoticeTimerRef.current);
      exitNoticeTimerRef.current = null;
    }
    setShowExitNotice(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (!window.history.state) {
        window.history.replaceState({ riveraRoot: true }, '');
      }
      ensureHistoryGuard();
    } catch {
      // ignore
    }

    const onUserInteract = () => {
      if (Date.now() >= exitArmedUntilRef.current) {
        ensureHistoryGuard();
      }
    };

    const onPopState = () => {
      const curr = stateRef.current;
      if (curr.hasPendingRename) {
        curr.onCloseRename();
        ensureHistoryGuard();
        return;
      }
      if (curr.hasPendingDelete) {
        curr.onCloseDelete();
        ensureHistoryGuard();
        return;
      }
      if (curr.hasReadyExport) {
        curr.onCloseReadyExport();
        ensureHistoryGuard();
        return;
      }
      if (curr.showUploadModal) {
        curr.onCloseUploadModal();
        ensureHistoryGuard();
        return;
      }
      if (!curr.isAtRoot) {
        clearExitPrompt();
        curr.onReturnToRoot();
        ensureHistoryGuard();
        return;
      }

      if (Date.now() < exitArmedUntilRef.current) {
        clearExitPrompt();
        return;
      }

      exitArmedUntilRef.current = Date.now() + 2200;
      setShowExitNotice(true);
      if (exitNoticeTimerRef.current !== null) {
        window.clearTimeout(exitNoticeTimerRef.current);
      }
      exitNoticeTimerRef.current = window.setTimeout(() => {
        exitNoticeTimerRef.current = null;
        exitArmedUntilRef.current = 0;
        setShowExitNotice(false);
        ensureHistoryGuard();
      }, 2200);
    };

    window.addEventListener('pointerdown', onUserInteract, { capture: true, passive: true });
    window.addEventListener('keydown', onUserInteract, { capture: true });
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('pointerdown', onUserInteract, true);
      window.removeEventListener('keydown', onUserInteract, true);
      window.removeEventListener('popstate', onPopState);
      if (exitNoticeTimerRef.current !== null) {
        window.clearTimeout(exitNoticeTimerRef.current);
        exitNoticeTimerRef.current = null;
      }
    };
  }, [clearExitPrompt, ensureHistoryGuard]);

  useEffect(() => {
    if (showUploadModal || hasPendingDelete || hasPendingRename || hasReadyExport) {
      clearExitPrompt();
      ensureHistoryGuard();
    }
  }, [
    clearExitPrompt,
    ensureHistoryGuard,
    hasPendingDelete,
    hasPendingRename,
    hasReadyExport,
    showUploadModal,
  ]);

  return {
    showExitNotice,
    clearExitPrompt,
    ensureHistoryGuard,
  };
}
