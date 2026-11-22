import '@fontsource/outfit/latin-500.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-700.css';
import '@fontsource/outfit/latin-ext-500.css';
import '@fontsource/outfit/latin-ext-600.css';
import '@fontsource/outfit/latin-ext-700.css';
import '@fontsource/plus-jakarta-sans/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-500.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/plus-jakarta-sans/latin-ext-400.css';
import '@fontsource/plus-jakarta-sans/latin-ext-500.css';
import '@fontsource/plus-jakarta-sans/latin-ext-600.css';
import '@fontsource/plus-jakarta-sans/latin-ext-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/latin-ext-400.css';
import '@fontsource/jetbrains-mono/latin-ext-500.css';
import '@fontsource/jetbrains-mono/latin-ext-600.css';
import '@fontsource/jetbrains-mono/latin-ext-700.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { PromoWebsiteView } from './components/PromoWebsiteView.tsx';
import { initAppServiceWorker } from './hooks/usePWAInstall.ts';
import './index.css';

initAppServiceWorker();

function StandalonePromoApp() {
  const [lang, setLang] = useState<'pt' | 'en'>('pt');

  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.removeAttribute('data-palette');
    document.documentElement.style.colorScheme = 'dark';
  }, []);

  return (
    <PromoWebsiteView
      language={lang}
      onChangeLanguage={setLang}
      onOpenPlayer={() => {
        window.location.assign('/');
      }}
    />
  );
}

createRoot(document.getElementById('site-root')!).render(
  <AppErrorBoundary>
    <StandalonePromoApp />
  </AppErrorBoundary>
);
