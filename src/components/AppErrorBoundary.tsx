import { Component, ErrorInfo, ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Rivera V/S runtime guard caught an error:', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-dvh w-full bg-[#000000] text-[#F1F3F5] flex items-center justify-center px-5 py-8 select-none">
        <div className="w-full max-w-sm rounded-2xl border border-[#2B303A] bg-[#14171D] p-6 text-center shadow-2xl space-y-4">
          <div className="mx-auto w-12 h-12 rounded-xl bg-[#D99B26]/15 border border-[#D99B26]/35 flex items-center justify-center text-[#D99B26] font-extrabold text-lg">
            V/S
          </div>
          <div className="space-y-1.5">
            <h1 className="text-base font-bold text-white">
              O player precisou ser reiniciado
            </h1>
            <p className="text-xs text-[#9CA3AF] leading-relaxed">
              Suas playlists, músicas e ajustes salvos continuam protegidos no aparelho.
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleReload}
            className="w-full py-3 px-4 rounded-xl bg-[#D99B26] hover:bg-[#e5a832] active:scale-[0.98] text-[#111216] text-xs font-extrabold uppercase tracking-wider transition-all cursor-pointer"
          >
            Recarregar Player
          </button>
        </div>
      </div>
    );
  }
}
