import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowLeftRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Gauge,
  Laptop,
  Minus,
  Monitor,
  Music2,
  Play,
  Plus,
  Sliders,
  Smartphone,
  Square,
  Volume2,
} from 'lucide-react';
import heroStageImg from '../assets/images/hero_stage_player_1795376953979.jpg';
import featureMixerImg from '../assets/images/feature_live_mixer_1795376954950.jpg';
import featureRehearsalImg from '../assets/images/feature_band_rehearsal_1795376955341.jpg';
import featureDevicesImg from '../assets/images/feature_multiplatform_devices_1795376954317.jpg';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { APP_VERSION } from '../storage/studioStorage';
import {
  isAiStudioUrl,
  loadSavedDistributionUrl,
  normalizeExternalUrl,
  resolveAppDistributionLinks,
  saveDistributionUrl,
} from '../utils/appDistribution';
import { copyTextReliable } from '../utils/clipboard';
import { createAudioContextSafe, resumeAudioContextSafe } from '../utils/platform';

export type PromoPlatformId = 'android' | 'windows' | 'macos' | 'web';

interface PromoWebsiteViewProps {
  language?: 'pt' | 'en';
  onOpenPlayer: () => void;
  onChangeLanguage?: (lang: 'pt' | 'en') => void;
}

export const PromoWebsiteView: React.FC<PromoWebsiteViewProps> = ({
  language = 'pt',
  onOpenPlayer,
  onChangeLanguage,
}) => {
  const pwa = usePWAInstall();
  const isPt = language !== 'en';

  const [selectedPlatform, setSelectedPlatform] = useState<PromoPlatformId>('android');
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  // Interactive Stage L/R & Pitch Simulator state
  const [simPitch, setSimPitch] = useState(0);
  const [simSpeedPct, setSimSpeedPct] = useState(100);
  const [simVolL, setSimVolL] = useState(1);
  const [simVolR, setSimVolR] = useState(1);
  const [simSwapLR, setSimSwapLR] = useState(false);
  const [isSimPlaying, setIsSimPlaying] = useState(false);

  // Audio preview nodes for the interactive L/R demo
  const simCtxRef = useRef<AudioContext | null>(null);
  const simTimerRef = useRef<number | null>(null);
  const simParamsRef = useRef({ simPitch, simSpeedPct, simVolL, simVolR, simSwapLR });
  simParamsRef.current = { simPitch, simSpeedPct, simVolL, simVolR, simSwapLR };

  // Releases / APK distribution URL synced with app settings
  const [releasesUrl, setReleasesUrl] = useState<string>(() => loadSavedDistributionUrl());
  const [releasesInput, setReleasesInput] = useState(releasesUrl);
  const [releasesError, setReleasesError] = useState<string | null>(null);
  const [showReleasesConfig, setShowReleasesConfig] = useState(false);
  const [copiedPromoLink, setCopiedPromoLink] = useState(false);
  const [installNotice, setInstallNotice] = useState<string | null>(null);

  // Validated Contact Form state
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPlatform, setContactPlatform] = useState<PromoPlatformId>('android');
  const [contactMessage, setContactMessage] = useState('');
  const [formErrors, setFormErrors] = useState<{ name?: string; email?: string; message?: string }>({});
  const [submittedInquiry, setSubmittedInquiry] = useState<{
    name: string;
    email: string;
    platform: string;
    message: string;
  } | null>(null);
  const [copiedInquiry, setCopiedInquiry] = useState(false);
  const copiedPromoTimerRef = useRef<number | null>(null);
  const copiedInquiryTimerRef = useRef<number | null>(null);

  const distributionLinks = useMemo(
    () => resolveAppDistributionLinks(releasesUrl),
    [releasesUrl]
  );
  const shareUrl = distributionLinks.promoSiteUrl;
  const activePlatformDownloadUrl =
    selectedPlatform === 'android'
      ? distributionLinks.androidInstallUrl || distributionLinks.releasesPageUrl
      : distributionLinks.releasesPageUrl;

  const stopSimulatorAudio = useCallback(() => {
    if (simTimerRef.current !== null) {
      window.clearTimeout(simTimerRef.current);
      simTimerRef.current = null;
    }
    if (simCtxRef.current) {
      simCtxRef.current.close().catch(() => {});
      simCtxRef.current = null;
    }
    setIsSimPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      stopSimulatorAudio();
      if (copiedPromoTimerRef.current !== null) {
        window.clearTimeout(copiedPromoTimerRef.current);
        copiedPromoTimerRef.current = null;
      }
      if (copiedInquiryTimerRef.current !== null) {
        window.clearTimeout(copiedInquiryTimerRef.current);
        copiedInquiryTimerRef.current = null;
      }
    };
  }, [stopSimulatorAudio]);

  const playSimulatorBeat = useCallback((ctx: AudioContext, step: number) => {
    const {
      simPitch: pitch,
      simVolL: volL,
      simVolR: volR,
      simSwapLR: swap,
    } = simParamsRef.current;

    const now = ctx.currentTime;
    const isDownbeat = step % 4 === 0;

    // Channel A: Backing VS Warm Synth Pad/Bass (Channel L by default)
    const vsPan = swap ? 1 : -1;
    const vsGainVal = (swap ? volR : volL) * 0.16;
    if (vsGainVal > 0.002) {
      const rootMidi = [48, 55, 57, 53][Math.floor(step / 4) % 4] + pitch;
      const freq = 440 * Math.pow(2, (rootMidi - 69) / 12);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      pan.pan.setValueAtTime(vsPan, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(vsGainVal, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      osc.connect(gain);
      gain.connect(pan);
      pan.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    }

    // Channel B: Metronome Click / Guide (Channel R by default)
    const clickPan = swap ? -1 : 1;
    const clickGainVal = (swap ? volL : volR) * 0.22;
    if (clickGainVal > 0.002) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isDownbeat ? 1320 : 880, now);
      pan.pan.setValueAtTime(clickPan, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(clickGainVal, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      osc.connect(gain);
      gain.connect(pan);
      pan.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    }
  }, []);

  const toggleSimulatorAudio = useCallback(async () => {
    if (isSimPlaying) {
      stopSimulatorAudio();
      return;
    }

    const ctx = createAudioContextSafe();
    if (!ctx) return;
    await resumeAudioContextSafe(ctx);
    simCtxRef.current = ctx;
    setIsSimPlaying(true);

    let step = 0;
    playSimulatorBeat(ctx, step);

    const scheduleNext = () => {
      const bpm = Math.max(60, Math.min(200, Math.round(116 * (simParamsRef.current.simSpeedPct / 100))));
      const intervalMs = Math.round(60000 / bpm);
      simTimerRef.current = window.setTimeout(() => {
        if (!simCtxRef.current) return;
        step += 1;
        playSimulatorBeat(simCtxRef.current, step);
        scheduleNext();
      }, intervalMs);
    };
    scheduleNext();
  }, [isSimPlaying, playSimulatorBeat, stopSimulatorAudio]);

  const markImageFailed = (key: string) => {
    setFailedImages((prev) => ({ ...prev, [key]: true }));
  };

  const handleCopyPromoUrl = async () => {
    if (!shareUrl) return;
    await copyTextReliable(shareUrl);
    if (copiedPromoTimerRef.current !== null) {
      window.clearTimeout(copiedPromoTimerRef.current);
    }
    setCopiedPromoLink(true);
    copiedPromoTimerRef.current = window.setTimeout(() => {
      setCopiedPromoLink(false);
      copiedPromoTimerRef.current = null;
    }, 3200);
  };

  const handleSaveReleasesUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setReleasesError(null);
    const trimmed = releasesInput.trim();
    if (!trimmed) {
      saveDistributionUrl('');
      setReleasesUrl('');
      setReleasesInput('');
      setShowReleasesConfig(false);
      return;
    }
    if (isAiStudioUrl(trimmed)) {
      setReleasesError(
        isPt
          ? 'Esse link é do AI Studio. Informe seu GitHub Releases, link .apk ou domínio publicado.'
          : 'That is an AI Studio URL. Enter your GitHub Releases, .apk, or published domain.'
      );
      return;
    }
    const clean = normalizeExternalUrl(trimmed);
    if (!clean) {
      setReleasesError(
        isPt ? 'Informe uma URL válida começando com https://.' : 'Enter a valid https:// URL.'
      );
      return;
    }
    const saved = saveDistributionUrl(clean);
    setReleasesUrl(saved.savedUrl);
    setReleasesInput(saved.savedUrl);
    setShowReleasesConfig(false);
  };

  const handleInstallWebApp = async () => {
    setInstallNotice(null);
    if (pwa.isInstallable) {
      const accepted = await pwa.install();
      if (accepted) {
        setInstallNotice(
          isPt
            ? 'Instalado com sucesso. Você já pode abrir pelo ícone na sua tela inicial.'
            : 'Installed successfully. You can now launch it offline from your home screen.'
        );
        return;
      }
    }
    if (pwa.isIOS) {
      setInstallNotice(
        isPt
          ? 'No iPhone/iPad: abra este link no Safari, toque em Compartilhar e depois em "Adicionar à Tela de Início".'
          : 'On iPhone/iPad: open in Safari, tap Share, and select "Add to Home Screen".'
      );
      return;
    }
    setInstallNotice(
      isPt
        ? 'No navegador: abra o menu (⋮) e toque em "Instalar app" ou clique em Abrir Player para testar agora.'
        : 'In Chrome/Edge: open the browser menu (⋮) and choose "Install app", or launch the Web Player directly.'
    );
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { name?: string; email?: string; message?: string } = {};
    const cleanName = contactName.trim();
    const cleanEmail = contactEmail.trim();
    const cleanMsg = contactMessage.trim();

    if (cleanName.length < 2) {
      errors.name = isPt ? 'Informe seu nome completo.' : 'Please enter your name.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      errors.email = isPt ? 'Informe um e-mail válido.' : 'Please enter a valid email address.';
    }
    if (cleanMsg.length < 8) {
      errors.message = isPt
        ? 'Escreva uma mensagem curta sobre como pretende usar o app.'
        : 'Please share a brief note about your setup.';
    }

    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const platformLabels: Record<PromoPlatformId, string> = {
      android: 'Android (.apk / Play Store)',
      windows: 'Windows (.exe)',
      macos: 'macOS (.dmg / .app)',
      web: 'Web / iPhone / iPad (PWA)',
    };

    setSubmittedInquiry({
      name: cleanName,
      email: cleanEmail,
      platform: platformLabels[contactPlatform],
      message: cleanMsg,
    });
  };

  const handleCopySubmittedSummary = async () => {
    if (!submittedInquiry) return;
    const summary = `Rivera V/S Player · Contato\nNome: ${submittedInquiry.name}\nE-mail: ${submittedInquiry.email}\nPlataforma: ${submittedInquiry.platform}\nMensagem: ${submittedInquiry.message}`;
    await copyTextReliable(summary);
    if (copiedInquiryTimerRef.current !== null) {
      window.clearTimeout(copiedInquiryTimerRef.current);
    }
    setCopiedInquiry(true);
    copiedInquiryTimerRef.current = window.setTimeout(() => {
      setCopiedInquiry(false);
      copiedInquiryTimerRef.current = null;
    }, 3000);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const simEffectiveBpm = Math.round(116 * (simSpeedPct / 100));
  const simPitchFormatted = simPitch > 0 ? `+${simPitch} st` : simPitch === 0 ? '0 st (Original)' : `${simPitch} st`;

  const platformDetails: Record<
    PromoPlatformId,
    {
      name: string;
      formatLabel: string;
      requirements: string;
      summary: string;
      highlights: string[];
      ctaLabel: string;
    }
  > = {
    android: {
      name: 'Android (Celular e Tablet)',
      formatLabel: 'RiveraVSPlayer-Android.apk · RiveraVSPlayer-Android.aab',
      requirements: 'Android 8.0+ · Armazenamento interno de áudios',
      summary: isPt
        ? 'Instale direto pelo APK offline no seu celular/tablet ou publique o App Bundle (.aab) assinado na Google Play Store. Importa MP3, WAV, M4A, FLAC e OGG direto da memória.'
        : 'Install directly via offline APK on phone/tablet or publish the signed App Bundle (.aab) to Google Play Store. Imports MP3, WAV, M4A, FLAC, and OGG from device storage.',
      highlights: isPt
        ? [
            'Importação direta de músicas do armazenamento interno e pastas',
            'Suporte a cabo Y (P2 → 2× P10) e interfaces USB OTG',
            'Modo tela cheia vertical e horizontal para suporte de pedestal',
          ]
        : [
            'Direct local track import from internal device storage',
            'Supports Y-cables (3.5mm to dual 1/4") and USB OTG interfaces',
            'Portrait and landscape stage layout for mic-stand mounts',
          ],
      ctaLabel: isPt ? 'Baixar APK / AAB Android' : 'Download Android APK / AAB',
    },
    windows: {
      name: 'Windows (10 e 11 · 64-bit)',
      formatLabel: 'Instalador .exe · Versão Portátil .exe',
      requirements: 'Windows 10 / 11 (x64) · Funciona 100% sem internet',
      summary: isPt
        ? 'Aplicativo desktop dedicado com inicialização instantânea via protocolo local app://, bloqueio contra requisições externas e suporte completo a interfaces de áudio ASIO/WASAPI.'
        : 'Dedicated desktop application with instant local startup, strict offline isolation, and full support for desktop audio interfaces.',
      highlights: isPt
        ? [
            'Versão instalável ou executável portátil para levar no pendrive',
            'Janela redimensionável para notebook de palco ou mesa de som',
            'Exportação direta de faixas transpostas em formato .wav',
          ]
        : [
            'Full installer and portable executable ready for USB flash drives',
            'Resizable dual-pane desktop layout for live laptops',
            'Direct offline WAV bounce with pitch and tempo baked in',
          ],
      ctaLabel: isPt ? 'Baixar para Windows (.exe)' : 'Download for Windows (.exe)',
    },
    macos: {
      name: 'macOS (Apple Silicon e Intel)',
      formatLabel: 'Imagem .dmg · Pacote .app Universal',
      requirements: 'macOS 12+ (M1/M2/M3/M4 e Intel) · Offline-first',
      summary: isPt
        ? 'Compilação universal nativa para MacBook e iMac com suporte a CoreAudio, atalhos rápidos de teclado e biblioteca persistente no próprio computador.'
        : 'Universal macOS desktop bundle built for Apple Silicon and Intel Macs with persistent local track storage.',
      highlights: isPt
        ? [
            'Compatível com placas CoreAudio multi-saída e mixers USB',
            'Troca instantânea entre faixas da playlist durante o show',
            'Zero dependência de nuvem ou assinatura mensal',
          ]
        : [
            'Seamless CoreAudio interface and USB mixer support',
            'Zero-latency track switching across live show setlists',
            'Zero cloud lock-in or monthly subscriptions',
          ],
      ctaLabel: isPt ? 'Baixar para macOS (.dmg)' : 'Download for macOS (.dmg)',
    },
    web: {
      name: 'Web & iPhone / iPad (PWA Offline)',
      formatLabel: 'PWA Instalável · Safari / Chrome / Edge',
      requirements: 'Qualquer navegador moderno · Cache local via Service Worker',
      summary: isPt
        ? 'Abra direto no navegador para testar agora mesmo ou instale na Tela de Início do iPhone, iPad, Android ou computador para usar sem internet.'
        : 'Launch straight in your browser to try right now or install to your Home Screen on iPhone, iPad, Android, or desktop for offline shows.',
      highlights: isPt
        ? [
            'Teste com as faixas de demonstração já incluídas no app',
            'Mesma engine WSOLA de Pitch e BPM rodando localmente no aparelho',
            'Atualização automática quando conectado ao Wi-Fi',
          ]
        : [
            'Try immediately with built-in stereo L/R demo tracks',
            'Full WSOLA Pitch & BPM engine running locally on device',
            'Automatic background updates when back on Wi-Fi',
          ],
      ctaLabel: isPt ? 'Instalar PWA / Abrir Player' : 'Install PWA / Open Player',
    },
  };

  const faqItems = isPt
    ? [
        {
          q: 'Como funciona a separação L/R com cabo P2 para dois P10?',
          a: 'Muitos músicos usam VS estéreo dividido: clique e guia vocal no canal L (esquerdo) e playback musical no canal R (direito). Conectando um cabo Y P2 estéreo para 2× P10 mono, você controla os volumes de L e R separados na tela do Rivera V/S Player ou inverte os lados com 1 toque sem precisar tirar os cabos da mesa.',
        },
        {
          q: 'Preciso de internet durante o show ou ensaio?',
          a: 'Não. O Rivera V/S Player segue arquitetura 100% offline-first: todas as músicas importadas, formas de onda, BPM, afinação (Pitch) e playlists ficam gravadas no banco interno (IndexedDB) do seu celular ou computador.',
        },
        {
          q: 'Alterar o tom (Pitch) estraga o andamento ou altera o BPM?',
          a: 'Não. O processador WSOLA em tempo real altera a tonalidade de -12 a +12 semitons de forma independente da velocidade (BPM), e também permite acelerar ou desacelerar o BPM sem alterar o tom original da música.',
        },
        {
          q: 'Quais formatos de áudio posso importar para o app?',
          a: 'Você pode importar arquivos MP3, WAV, M4A, AAC, OGG e FLAC direto da memória interna do celular Android, do app Arquivos no iPhone/iPad ou de pastas inteiras no Windows e macOS.',
        },
      ]
    : [
        {
          q: 'How does independent L/R routing work with a Y-cable?',
          a: 'Live backing tracks often split click/cues on Left and instrumentation on Right. Using independent L and R sliders plus one-tap L/R swap, you can balance or mute either feed on the fly without unplugging cables.',
        },
        {
          q: 'Does it require Wi-Fi or mobile data on stage?',
          a: 'No. Rivera V/S Player is 100% offline-first. Every imported audio file, waveform peak map, pitch/BPM preset, and setlist is persisted locally on your device.',
        },
        {
          q: 'Does changing Pitch affect song BPM?',
          a: 'No. The real-time WSOLA DSP engine shifts pitch from -12 to +12 semitones independently from playback tempo, and vice versa.',
        },
        {
          q: 'Which audio file formats are supported?',
          a: 'MP3, WAV, M4A, AAC, OGG, and FLAC files from local device storage or desktop folders.',
        },
      ];

  const activeDownload = platformDetails[selectedPlatform];

  return (
    <div className="min-h-[100dvh] bg-[#0A0B0E] text-zinc-100 font-sans antialiased selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Bar Contract: Strict 1-row, 3-zone layout separated by gap-8 */}
      <header className="sticky top-0 z-40 h-14 sm:h-16 bg-[#0A0B0E]/92 backdrop-blur-md border-b border-zinc-800/80">
        <div className="max-w-6xl h-full mx-auto px-4 sm:px-6 flex items-center justify-between gap-8">
          {/* Zone 1: Single clean text wordmark */}
          <a
            href="#hero"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('hero');
            }}
            className="font-display text-base sm:text-lg font-bold tracking-tight text-zinc-100 whitespace-nowrap shrink-0"
          >
            Rivera V/S Player
          </a>

          {/* Zone 2: 4 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400">
            <a
              href="#recursos"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('recursos');
              }}
              className="hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0"
            >
              {isPt ? 'Recursos' : 'Features'}
            </a>
            <a
              href="#palco"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('palco');
              }}
              className="hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0"
            >
              {isPt ? 'Palco L/R' : 'Stage L/R'}
            </a>
            <a
              href="#downloads"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('downloads');
              }}
              className="hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0"
            >
              Downloads
            </a>
            <a
              href="#contato"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('contato');
              }}
              className="hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0"
            >
              {isPt ? 'Contato' : 'Contact'}
            </a>
          </nav>

          {/* Zone 3: Single primary action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={onOpenPlayer}
              className="py-2 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-[#0D0F12] text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              {isPt ? 'Abrir Player' : 'Open Player'}
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* 1. HERO SECTION */}
        <section id="hero" className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-between gap-6">
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-400 tracking-wide">
                  <span>Android</span>
                  <span aria-hidden="true">·</span>
                  <span>Windows</span>
                  <span aria-hidden="true">·</span>
                  <span>macOS</span>
                  <span aria-hidden="true">·</span>
                  <span>100% Offline</span>
                </div>

                <h1
                  className="font-display font-bold tracking-tight text-zinc-100 leading-[1.08]"
                  style={{ fontSize: 'clamp(2.25rem, 4vw, 3.65rem)', textWrap: 'balance' }}
                >
                  {isPt
                    ? 'Seu VS de palco no tom certo, no tempo exato, sem depender de internet.'
                    : 'Your live backing tracks in the right key and tempo, completely offline.'}
                </h1>

                <p className="text-base sm:text-[17px] text-zinc-300 leading-relaxed max-w-[65ch]">
                  {isPt
                    ? 'O Rivera V/S Player reúne troca instantânea de faixas, ajuste de Pitch (±12 semitons) e BPM em tempo real via WSOLA, e volumes L/R independentes para separar clique e base no cabo Y durante o show.'
                    : 'Rivera V/S Player delivers instant track triggering, real-time WSOLA pitch (±12 semitones) and BPM control, and independent L/R routing for live click and backing feeds.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <button
                  type="button"
                  onClick={() => scrollToSection('downloads')}
                  className="min-h-[46px] px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0D0F12] text-sm font-bold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span>{isPt ? 'Baixar para seu dispositivo' : 'Download for your device'}</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenPlayer}
                  className="min-h-[46px] px-3 py-2 text-sm font-semibold text-zinc-200 hover:text-amber-400 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  <span>{isPt ? 'Testar Player no Navegador' : 'Launch Web Player'}</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>
              </div>
            </div>

            <div className="lg:col-span-6 flex">
              <div className="relative w-full aspect-video lg:aspect-auto lg:h-full min-h-[260px] rounded-2xl overflow-hidden bg-[#12151C] border border-zinc-800/90">
                {!failedImages.hero ? (
                  <img
                    src={heroStageImg}
                    alt={
                      isPt
                        ? 'Notebook e tablet conectados a interface de áudio no palco durante passagem de som'
                        : 'Laptop and tablet connected to a stage audio interface during soundcheck'
                    }
                    referrerPolicy="no-referrer"
                    onError={() => markImageFailed('hero')}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-zinc-900 via-[#15181E] to-amber-950/30 flex flex-col items-center justify-center p-6 text-center gap-3">
                    <Music2 className="w-10 h-10 text-amber-400" />
                    <span className="font-display text-lg font-semibold text-zinc-100">
                      Rivera V/S Player
                    </span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />
                <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-200">
                  <span className="font-medium">
                    {isPt
                      ? 'Passagem de som e show ao vivo · Cabo Y P2/P10 ou Interface USB'
                      : 'Live soundcheck & stage rig · Y-cable or USB Audio Interface'}
                  </span>
                  <span className="font-mono tabular-nums text-amber-300">v{APP_VERSION}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 4-column Technical Specs Strip directly below Hero Split */}
          <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 border border-zinc-800/90 rounded-2xl bg-[#12151C] divide-y lg:divide-y-0 lg:divide-x divide-zinc-800/90">
            <div className="p-5 flex flex-col gap-1">
              <span className="font-mono tabular-nums text-2xl font-bold text-zinc-100">±12 st</span>
              <span className="text-xs text-zinc-400 leading-relaxed">
                {isPt ? 'Transposição de tom sem alterar o BPM' : 'Key shift without changing BPM'}
              </span>
            </div>
            <div className="p-5 flex flex-col gap-1">
              <span className="font-mono tabular-nums text-2xl font-bold text-zinc-100">L / R</span>
              <span className="text-xs text-zinc-400 leading-relaxed">
                {isPt ? 'Volumes independentes e inversão em 1 toque' : 'Independent channel gain & 1-tap swap'}
              </span>
            </div>
            <div className="p-5 flex flex-col gap-1">
              <span className="font-mono tabular-nums text-2xl font-bold text-zinc-100">0 ms</span>
              <span className="text-xs text-zinc-400 leading-relaxed">
                {isPt ? 'Disparo imediato com pré-carregamento da lista' : 'Instant track trigger via RAM prefetch'}
              </span>
            </div>
            <div className="p-5 flex flex-col gap-1">
              <span className="font-mono tabular-nums text-2xl font-bold text-zinc-100">100%</span>
              <span className="text-xs text-zinc-400 leading-relaxed">
                {isPt ? 'Músicas e presets salvos direto no aparelho' : 'Tracks and presets stored offline'}
              </span>
            </div>
          </div>
        </section>

        {/* 2. CAPABILITIES ASYMMETRIC BENTO GRID */}
        <section id="recursos" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 border-t border-zinc-800/80">
          <div className="max-w-2xl mb-9">
            <p className="text-xs font-medium text-amber-400 tracking-wide mb-2">
              {isPt ? 'Projetado para quem toca ao vivo' : 'Built for live performance'}
            </p>
            <h2
              className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-zinc-100"
              style={{ textWrap: 'balance' }}
            >
              {isPt
                ? 'Controle real de estúdio no bolso ou no notebook de palco'
                : 'Real studio control on your phone or stage laptop'}
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Marquee Card 01 (col-span-2) */}
            <article className="lg:col-span-2 bg-[#12151C] border border-zinc-800/90 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              <div className="flex flex-col gap-3">
                <h3 className="font-display text-xl font-bold text-zinc-100">
                  {isPt ? '01. Motor WSOLA de Pitch e BPM independentes' : '01. Real-time WSOLA Pitch & BPM engine'}
                </h3>
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {isPt
                    ? 'A cantora pediu meio tom abaixo ou o baterista quer 4 BPM a mais na abertura? Ajuste tom (-12 a +12 semitons) e velocidade separadamente sem artefatos robóticos e exporte o áudio pronto em .wav quando precisar.'
                    : 'Shift song key from -12 to +12 semitones or dial in exact BPM adjustments independently with clean WSOLA time-stretching, plus direct WAV export.'}
                </p>
                <div className="pt-2 flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-zinc-400">
                  <span>AudioWorklet DSP</span>
                  <span aria-hidden="true">·</span>
                  <span>Exportação .WAV</span>
                  <span aria-hidden="true">·</span>
                  <span>Detecção de BPM</span>
                </div>
              </div>

              <div className="aspect-[4/3] rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
                {!failedImages.mixer ? (
                  <img
                    src={featureMixerImg}
                    alt={
                      isPt
                        ? 'Cabos P10 conectados nos canais L e R de mesa de som com medidores âmbar'
                        : 'Dual 1/4 inch plugs patched into live mixer channels with amber VU meters'
                    }
                    referrerPolicy="no-referrer"
                    onError={() => markImageFailed('mixer')}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-amber-400">
                    <Sliders className="w-8 h-8" />
                  </div>
                )}
              </div>
            </article>

            {/* Card 02 (col-span-1) */}
            <article className="lg:col-span-1 bg-[#12151C] border border-zinc-800/90 rounded-2xl p-6 flex flex-col justify-between gap-4">
              <div className="flex flex-col gap-3">
                <h3 className="font-display text-xl font-bold text-zinc-100">
                  {isPt ? '02. Roteamento Estéreo L/R para Cabo Y' : '02. Stereo L/R Split for Y-Cables'}
                </h3>
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {isPt
                    ? 'Controle o volume e o mute dos canais Esquerdo (L) e Direito (R) em sliders grandes feitos para o toque no palco. Se o técnico inverteu os plugues na direct box, clique em Inverter L/R sem desconectar nada.'
                    : 'Adjust or mute Left and Right channels independently with large stage-ready faders, plus one-tap L/R swap when DI lines are patched backwards.'}
                </p>
              </div>
              <div className="pt-3 border-t border-zinc-800/80 text-xs font-mono tabular-nums text-zinc-400 flex items-center justify-between">
                <span>P2 → 2× P10 Mono</span>
                <span className="text-amber-400">L ↔ R</span>
              </div>
            </article>

            {/* Card 03 (col-span-1) */}
            <article className="lg:col-span-1 bg-[#12151C] border border-zinc-800/90 rounded-2xl p-6 flex flex-col justify-between gap-4">
              <div className="flex flex-col gap-3">
                <h3 className="font-display text-xl font-bold text-zinc-100">
                  {isPt ? '03. Setlists, Renomeação e Auto / Manual' : '03. Setlists, Renaming & Auto/Manual'}
                </h3>
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {isPt
                    ? 'Monte repertórios por show, reordene faixas segurando e arrastando, renomeie direto pelo ícone de lápis e escolha entre parar no fim de cada música (Manual) ou emendar a próxima automaticamente (Auto).'
                    : 'Build show-specific setlists, reorder tracks by hold-and-drag, rename songs in place with the pencil icon, and switch cleanly between Manual stop and Auto advance.'}
                </p>
              </div>
              <div className="pt-3 border-t border-zinc-800/80 text-xs font-mono tabular-nums text-zinc-400 flex items-center justify-between">
                <span>{isPt ? 'Ordem A–Z ou Palco' : 'A–Z or Custom Order'}</span>
                <span className="text-amber-400">Auto / Manual</span>
              </div>
            </article>

            {/* Marquee Card 04 (col-span-2) */}
            <article className="lg:col-span-2 bg-[#12151C] border border-zinc-800/90 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              <div className="aspect-[4/3] rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 order-2 md:order-1">
                {!failedImages.rehearsal ? (
                  <img
                    src={featureRehearsalImg}
                    alt={
                      isPt
                        ? 'Banda ensaiando no palco com fones in-ear e celular montado no pedestal'
                        : 'Live band rehearsing with in-ear monitors and phone mounted on mic stand'
                    }
                    referrerPolicy="no-referrer"
                    onError={() => markImageFailed('rehearsal')}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-amber-400">
                    <Smartphone className="w-8 h-8" />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 order-1 md:order-2">
                <h3 className="font-display text-xl font-bold text-zinc-100">
                  {isPt ? '04. Memória local segura, zero travamento em casa de show' : '04. Local storage built for zero-signal venues'}
                </h3>
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {isPt
                    ? 'Em porões, igrejas com sinal fraco ou eventos rurais, sua biblioteca nunca falha: os arquivos ficam gravados em IndexedDB nativo e a faixa seguinte é pré-decodificada em memória para disparar na hora do Play.'
                    : 'Basement clubs and dead-zone venues cannot interrupt your set: audio files live in local IndexedDB storage with pre-decoded next-track buffering.'}
                </p>
                <div className="pt-2 flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-zinc-400">
                  <span>MP3 · WAV · M4A · FLAC · OGG</span>
                  <span aria-hidden="true">·</span>
                  <span>IndexedDB Local</span>
                </div>
              </div>
            </article>
          </div>
        </section>

        {/* 3. INTERACTIVE STAGE SIMULATOR + MULTIPLATFORM PROOF */}
        <section id="palco" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 border-t border-zinc-800/80">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left: Interactive Audio Routing & Transposition Demo */}
            <div className="lg:col-span-7 bg-[#12151C] border border-zinc-800/90 rounded-2xl p-6 flex flex-col justify-between gap-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-amber-400 mb-1.5">
                    {isPt ? 'Demonstração interativa de áudio' : 'Interactive audio preview'}
                  </p>
                  <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
                    {isPt ? 'Teste o roteamento L/R e o ajuste de tom agora' : 'Try L/R split routing & key shifting live'}
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={toggleSimulatorAudio}
                  className={`min-h-[42px] px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    isSimPlaying
                      ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-600'
                      : 'bg-amber-500 hover:bg-amber-400 text-[#0D0F12]'
                  }`}
                >
                  {isSimPlaying ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>{isPt ? 'Parar Pulso L/R' : 'Stop L/R Demo'}</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{isPt ? 'Ouvir Pulso L/R' : 'Play L/R Demo'}</span>
                    </>
                  )}
                </button>
              </div>

              {/* Pitch & BPM Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-800/80">
                <div className="bg-[#0A0B0E] border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-amber-400" />
                      <span>{isPt ? 'Pitch (Tom)' : 'Pitch (Key)'}</span>
                    </span>
                    <span className="font-mono tabular-nums text-xs font-semibold text-amber-400">
                      {simPitchFormatted}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSimPitch((v) => Math.max(-12, v - 1))}
                      aria-label={isPt ? 'Diminuir meio tom' : 'Decrease half step'}
                      className="h-10 w-11 rounded-lg bg-[#161922] border border-zinc-700 hover:border-zinc-500 flex items-center justify-center text-zinc-100 cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimPitch(0)}
                      className="h-10 px-3 rounded-lg bg-[#161922] border border-zinc-800 text-xs font-mono tabular-nums text-zinc-300 hover:text-zinc-100 cursor-pointer"
                    >
                      {isPt ? 'Original' : 'Reset'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimPitch((v) => Math.min(12, v + 1))}
                      aria-label={isPt ? 'Aumentar meio tom' : 'Increase half step'}
                      className="h-10 w-11 rounded-lg bg-[#161922] border border-zinc-700 hover:border-zinc-500 flex items-center justify-center text-zinc-100 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="bg-[#0A0B0E] border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                      <Gauge className="w-3.5 h-3.5 text-amber-400" />
                      <span>BPM</span>
                    </span>
                    <span className="font-mono tabular-nums text-xs font-semibold text-amber-400">
                      {simEffectiveBpm} BPM ({simSpeedPct}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSimSpeedPct((v) => Math.max(70, v - 5))}
                      aria-label={isPt ? 'Diminuir BPM' : 'Decrease BPM'}
                      className="h-10 w-11 rounded-lg bg-[#161922] border border-zinc-700 hover:border-zinc-500 flex items-center justify-center text-zinc-100 cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimSpeedPct(100)}
                      className="h-10 px-3 rounded-lg bg-[#161922] border border-zinc-800 text-xs font-mono tabular-nums text-zinc-300 hover:text-zinc-100 cursor-pointer"
                    >
                      116 BPM
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimSpeedPct((v) => Math.min(140, v + 5))}
                      aria-label={isPt ? 'Aumentar BPM' : 'Increase BPM'}
                      className="h-10 w-11 rounded-lg bg-[#161922] border border-zinc-700 hover:border-zinc-500 flex items-center justify-center text-zinc-100 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Independent L/R Faders & Swap */}
              <div className="bg-[#0A0B0E] border border-zinc-800 rounded-xl p-4 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-400">
                    {simSwapLR
                      ? isPt
                        ? 'Saída física: L → Clique/Guia · R → Base VS'
                        : 'Physical output: L → Click/Cue · R → Backing VS'
                      : isPt
                        ? 'Saída física: L → Base VS · R → Clique/Guia'
                        : 'Physical output: L → Backing VS · R → Click/Cue'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSimSwapLR((s) => !s)}
                    className={`min-h-[36px] px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                      simSwapLR
                        ? 'bg-amber-500/15 border-amber-500/60 text-amber-300'
                        : 'bg-[#161922] border-zinc-700 text-zinc-200 hover:border-zinc-500'
                    }`}
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>{simSwapLR ? (isPt ? 'L/R Invertido' : 'L/R Swapped') : isPt ? 'Inverter L/R' : 'Swap L/R'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                        <span>{isPt ? 'Canal L (Base VS)' : 'Left Channel (VS)'}</span>
                      </span>
                      <span className="font-mono tabular-nums text-zinc-400">{Math.round(simVolL * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={simVolL}
                      onChange={(e) => setSimVolL(parseFloat(e.target.value))}
                      className="studio-slider w-full"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{isPt ? 'Canal R (Clique / Guia)' : 'Right Channel (Click)'}</span>
                      </span>
                      <span className="font-mono tabular-nums text-zinc-400">{Math.round(simVolR * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={simVolR}
                      onChange={(e) => setSimVolR(parseFloat(e.target.value))}
                      className="studio-slider w-full"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
                <span>
                  {isPt
                    ? 'Use fones estéreo para ouvir a separação entre os lados L e R.'
                    : 'Use stereo headphones to hear Left and Right separation.'}
                </span>
                <button
                  type="button"
                  onClick={onOpenPlayer}
                  className="font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                >
                  <span>{isPt ? 'Abrir no Player Completo' : 'Open Full Player'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Right: Devices Image + Target Setups */}
            <div className="lg:col-span-5 flex flex-col justify-between gap-5">
              <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-[#12151C] border border-zinc-800/90">
                {!failedImages.devices ? (
                  <img
                    src={featureDevicesImg}
                    alt={
                      isPt
                        ? 'Notebook, tablet e smartphone com interface de áudio sobre mesa escura'
                        : 'Laptop, tablet, and smartphone arranged alongside audio interface and studio headphones'
                    }
                    referrerPolicy="no-referrer"
                    onError={() => markImageFailed('devices')}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[#12151C] text-amber-400">
                    <Laptop className="w-8 h-8" />
                  </div>
                )}
              </div>

              <div className="bg-[#12151C] border border-zinc-800/90 rounded-2xl p-6 flex flex-col gap-4 flex-1 justify-center">
                <h3 className="font-display text-lg font-bold text-zinc-100">
                  {isPt ? 'Feito para a rotina de palco' : 'Built around stage workflows'}
                </h3>
                <div className="flex flex-col divide-y divide-zinc-800/80 text-sm">
                  <div className="py-2.5 first:pt-0">
                    <p className="font-semibold text-zinc-200">
                      {isPt ? 'Ministérios de Louvor e Igrejas' : 'Worship Teams & Churches'}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      {isPt
                        ? 'Ajuste de tom imediato para vozes diferentes sem precisar renderizar um novo VS no estúdio.'
                        : 'Instant key shifting for different vocalists without re-rendering backing stems.'}
                    </p>
                  </div>
                  <div className="py-2.5">
                    <p className="font-semibold text-zinc-200">
                      {isPt ? 'Bandas Baile, Sertanejo e Eventos' : 'Cover Bands & Live Venues'}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      {isPt
                        ? 'Modo Auto para medleys sem pausa ou Manual para falar com o público entre as músicas.'
                        : 'Auto-advance for seamless medleys or Manual stop between songs.'}
                    </p>
                  </div>
                  <div className="py-2.5 last:pb-0">
                    <p className="font-semibold text-zinc-200">
                      {isPt ? 'Músicos Solo, Duplas e Estudo' : 'Solo Performers & Practice'}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      {isPt
                        ? 'Diminua o BPM para tirar solos difíceis e salve a velocidade favorita por música.'
                        : 'Slow down BPM to master complex passages with per-track preset memory.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. DOWNLOADS & DISTRIBUTION */}
        <section id="downloads" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 border-t border-zinc-800/80">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-amber-400 mb-2">
                {isPt ? 'Instaladores nativos e Web Offline' : 'Native installers & Offline Web'}
              </p>
              <h2
                className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-zinc-100"
                style={{ textWrap: 'balance' }}
              >
                {isPt ? 'Escolha o instalador do seu aparelho' : 'Choose the installer for your device'}
              </h2>
            </div>

            {shareUrl && (
              <button
                type="button"
                onClick={handleCopyPromoUrl}
                className="min-h-[40px] px-4 rounded-xl bg-[#12151C] border border-zinc-800 hover:border-zinc-600 text-xs font-semibold text-zinc-200 flex items-center gap-2 whitespace-nowrap self-start md:self-auto cursor-pointer"
              >
                {copiedPromoLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{isPt ? 'Link do site copiado' : 'Website URL copied'}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isPt ? 'Copiar link de divulgação' : 'Copy promo link'}</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Interactive Platform Tabs */}
          <div className="inline-flex flex-wrap items-center gap-1 p-1.5 rounded-xl bg-[#12151C] border border-zinc-800 mb-6">
            {(
              [
                { id: 'android', label: 'Android (.apk / .aab)', Icon: Smartphone },
                { id: 'windows', label: 'Windows (.exe)', Icon: Monitor },
                { id: 'macos', label: 'macOS (.dmg)', Icon: Laptop },
                { id: 'web', label: 'Web / iPhone / iPad', Icon: Music2 },
              ] as const
            ).map(({ id, label, Icon }) => {
              const active = selectedPlatform === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setSelectedPlatform(id);
                    setInstallNotice(null);
                  }}
                  className={`min-h-[42px] px-4 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    active
                      ? 'bg-amber-500 text-[#0D0F12]'
                      : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Selected Platform Panel */}
          <div className="bg-[#12151C] border border-zinc-800/90 rounded-2xl p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-7 flex flex-col gap-4">
              <div className="text-xs font-mono tabular-nums text-zinc-400">
                <span>{activeDownload.formatLabel}</span>
                <span className="mx-2" aria-hidden="true">·</span>
                <span>v{APP_VERSION}</span>
              </div>

              <h3 className="font-display text-2xl font-bold text-zinc-100">{activeDownload.name}</h3>
              <p className="text-sm text-zinc-300 leading-relaxed max-w-[65ch]">{activeDownload.summary}</p>
              <p className="text-xs text-zinc-400">{activeDownload.requirements}</p>

              <ul className="pt-2 flex flex-col gap-2 text-sm text-zinc-300">
                {activeDownload.highlights.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="text-amber-400 font-bold mt-0.5" aria-hidden="true">–</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-5 bg-[#0A0B0E] border border-zinc-800 rounded-xl p-5 flex flex-col gap-3.5">
              {selectedPlatform === 'web' ? (
                <>
                  <button
                    type="button"
                    onClick={handleInstallWebApp}
                    className="min-h-[46px] w-full px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0D0F12] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>{activeDownload.ctaLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenPlayer}
                    className="min-h-[44px] w-full px-4 rounded-xl bg-[#161922] border border-zinc-700 hover:border-zinc-500 text-sm font-semibold text-zinc-100 flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <Play className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>{isPt ? 'Abrir Player Web Agora' : 'Open Web Player Now'}</span>
                  </button>
                  {installNotice && (
                    <p className="text-xs text-amber-300 leading-relaxed pt-1">{installNotice}</p>
                  )}
                </>
              ) : (
                <>
                  {activePlatformDownloadUrl ? (
                    <a
                      href={activePlatformDownloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[46px] w-full px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0D0F12] text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                    >
                      <Download className="w-4 h-4 shrink-0" />
                      <span>{activeDownload.ctaLabel}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowReleasesConfig(true)}
                      className="min-h-[46px] w-full px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0D0F12] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      <Download className="w-4 h-4 shrink-0" />
                      <span>{activeDownload.ctaLabel}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onOpenPlayer}
                    className="min-h-[44px] w-full px-4 rounded-xl bg-[#161922] border border-zinc-700 hover:border-zinc-500 text-sm font-semibold text-zinc-100 flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <Play className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>{isPt ? 'Testar versão Web enquanto baixa' : 'Try Web version right now'}</span>
                  </button>

                  <div className="pt-1 flex items-center justify-between gap-2 text-xs text-zinc-400">
                    <span>
                      {activePlatformDownloadUrl
                        ? isPt
                          ? 'Link oficial de downloads ativo.'
                          : 'Official releases link active.'
                        : isPt
                          ? 'Vincule sua página de Releases do GitHub ou Play Store:'
                          : 'Link your GitHub Releases or Store URL:'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setReleasesError(null);
                        setShowReleasesConfig((v) => !v);
                      }}
                      className="text-amber-400 hover:text-amber-300 font-semibold whitespace-nowrap cursor-pointer"
                    >
                      {showReleasesConfig
                        ? isPt
                          ? 'Fechar'
                          : 'Close'
                        : activePlatformDownloadUrl
                          ? isPt
                            ? 'Alterar link'
                            : 'Edit link'
                          : isPt
                            ? 'Configurar link'
                            : 'Set link'}
                    </button>
                  </div>

                  {showReleasesConfig && (
                    <form onSubmit={handleSaveReleasesUrl} className="pt-2 border-t border-zinc-800 flex flex-col gap-2">
                      <label htmlFor="releases-url-input" className="text-[11px] text-zinc-400">
                        {isPt
                          ? 'Cole a URL do GitHub / Releases (ex: https://github.com/usuario/repo) ou link direto do .apk:'
                          : 'Paste your GitHub / Releases URL or direct .apk link:'}
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="releases-url-input"
                          type="url"
                          value={releasesInput}
                          onChange={(e) => {
                            setReleasesInput(e.target.value);
                            if (releasesError) setReleasesError(null);
                          }}
                          placeholder="https://github.com/usuario/repo"
                          className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-[#12151C] border border-zinc-700 focus:border-amber-500 focus:outline-none text-xs text-zinc-100"
                        />
                        <button
                          type="submit"
                          className="h-10 px-3.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[#0D0F12] text-xs font-bold whitespace-nowrap cursor-pointer"
                        >
                          {isPt ? 'Salvar' : 'Save'}
                        </button>
                      </div>
                      {releasesError && (
                        <p className="text-xs text-rose-400">{releasesError}</p>
                      )}
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        {/* 5. FAQ & CONTACT FORM */}
        <section id="contato" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 border-t border-zinc-800/80">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* FAQ Column */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <div>
                <p className="text-xs font-medium text-amber-400 mb-1.5">FAQ</p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
                  {isPt ? 'Dúvidas frequentes de quem usa no palco' : 'Common stage & technical questions'}
                </h2>
              </div>

              <div className="divide-y divide-zinc-800/90 border-t border-b border-zinc-800/90 mt-2">
                {faqItems.map((item, idx) => {
                  const isOpen = openFaqIdx === idx;
                  return (
                    <div key={item.q} className="py-4">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                        className="w-full flex items-center justify-between gap-4 text-left text-sm sm:text-base font-semibold text-zinc-100 hover:text-amber-300 cursor-pointer transition-colors"
                      >
                        <span>{item.q}</span>
                        <ChevronDown
                          className={`w-4 h-4 shrink-0 text-zinc-400 transition-transform duration-200 ${
                            isOpen ? 'rotate-180 text-amber-400' : ''
                          }`}
                        />
                      </button>
                      {isOpen && (
                        <p className="mt-2.5 text-sm text-zinc-300 leading-relaxed pr-6">{item.a}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Minimalist Validated Contact / Interest Form */}
            <div className="lg:col-span-6 bg-[#12151C] border border-zinc-800/90 rounded-2xl p-6 sm:p-7">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-zinc-100">
                {isPt ? 'Fale com o projeto ou peça o link de download' : 'Get in touch or request a build link'}
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1.5 leading-relaxed">
                {isPt
                  ? 'Quer suporte para sua banda, ministério ou precisa de ajuda para configurar no Android, Windows ou Mac?'
                  : 'Need help setting up your band rig on Android, Windows, or macOS? Send a quick note.'}
              </p>

              {submittedInquiry ? (
                <div className="mt-5 bg-[#0A0B0E] border border-emerald-500/40 rounded-xl p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-emerald-400 text-sm font-bold">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>
                      {isPt ? 'Mensagem validada e registrada' : 'Message validated and ready'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {isPt
                      ? `Obrigado, ${submittedInquiry.name}. Seus dados para ${submittedInquiry.platform} estão prontos. Você pode copiar o resumo abaixo para enviar direto pelo WhatsApp ou e-mail.`
                      : `Thank you, ${submittedInquiry.name}. Your ${submittedInquiry.platform} inquiry summary is ready below.`}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCopySubmittedSummary}
                      className="min-h-[40px] px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-[#0D0F12] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedInquiry ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>
                        {copiedInquiry
                          ? isPt
                            ? 'Resumo copiado'
                            : 'Summary copied'
                          : isPt
                            ? 'Copiar resumo'
                            : 'Copy summary'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSubmittedInquiry(null);
                        setContactMessage('');
                      }}
                      className="min-h-[40px] px-4 rounded-lg bg-[#161922] border border-zinc-700 text-xs font-semibold text-zinc-200 hover:border-zinc-500 cursor-pointer"
                    >
                      {isPt ? 'Enviar outra mensagem' : 'Send another note'}
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleContactSubmit} noValidate className="mt-5 flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="promo-contact-name" className="text-xs font-semibold text-zinc-300">
                        {isPt ? 'Seu nome' : 'Your name'}
                      </label>
                      <input
                        id="promo-contact-name"
                        type="text"
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        placeholder={isPt ? 'Ex: Lucas Andrade' : 'Ex: Alex Rivera'}
                        className="h-11 px-3.5 rounded-xl bg-[#0A0B0E] border border-zinc-800 focus:border-amber-500 focus:outline-none text-sm text-zinc-100 placeholder:text-zinc-500"
                      />
                      {formErrors.name && (
                        <span className="text-xs text-rose-400">{formErrors.name}</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="promo-contact-email" className="text-xs font-semibold text-zinc-300">
                        E-mail
                      </label>
                      <input
                        id="promo-contact-email"
                        type="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="voce@banda.com"
                        className="h-11 px-3.5 rounded-xl bg-[#0A0B0E] border border-zinc-800 focus:border-amber-500 focus:outline-none text-sm text-zinc-100 placeholder:text-zinc-500"
                      />
                      {formErrors.email && (
                        <span className="text-xs text-rose-400">{formErrors.email}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="promo-contact-platform" className="text-xs font-semibold text-zinc-300">
                      {isPt ? 'Sistema principal no palco' : 'Primary stage device'}
                    </label>
                    <select
                      id="promo-contact-platform"
                      value={contactPlatform}
                      onChange={(e) => setContactPlatform(e.target.value as PromoPlatformId)}
                      className="h-11 px-3.5 rounded-xl bg-[#0A0B0E] border border-zinc-800 focus:border-amber-500 focus:outline-none text-sm text-zinc-100"
                    >
                      <option value="android">Android (.apk / Play Store)</option>
                      <option value="windows">Windows (.exe)</option>
                      <option value="macos">macOS (.dmg / .app)</option>
                      <option value="web">Web / iPhone / iPad (PWA)</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="promo-contact-msg" className="text-xs font-semibold text-zinc-300">
                      {isPt ? 'Mensagem ou dúvida' : 'Message'}
                    </label>
                    <textarea
                      id="promo-contact-msg"
                      rows={3}
                      value={contactMessage}
                      onChange={(e) => setContactMessage(e.target.value)}
                      placeholder={
                        isPt
                          ? 'Conte como você pretende usar os VS L/R ou solicite o instalador...'
                          : 'Tell us about your live rig or request an installer link...'
                      }
                      className="p-3.5 rounded-xl bg-[#0A0B0E] border border-zinc-800 focus:border-amber-500 focus:outline-none text-sm text-zinc-100 placeholder:text-zinc-500 resize-y"
                    />
                    {formErrors.message && (
                      <span className="text-xs text-rose-400">{formErrors.message}</span>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="min-h-[46px] px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0D0F12] text-sm font-bold cursor-pointer transition-colors"
                  >
                    {isPt ? 'Enviar Mensagem' : 'Send Message'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-zinc-800/80 bg-[#0A0B0E]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-zinc-400">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display font-bold text-zinc-200">Rivera V/S Player</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">v{APP_VERSION}</span>
            <span aria-hidden="true">·</span>
            <span>Android · Windows · macOS · Web Offline</span>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            {onChangeLanguage && (
              <button
                type="button"
                onClick={() => onChangeLanguage(isPt ? 'en' : 'pt')}
                className="hover:text-zinc-100 transition-colors cursor-pointer"
              >
                {isPt ? 'English' : 'Português (BR)'}
              </button>
            )}
            <button
              type="button"
              onClick={() => scrollToSection('downloads')}
              className="hover:text-zinc-100 transition-colors cursor-pointer"
            >
              Downloads
            </button>
            <a
              href="/privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-100 transition-colors"
            >
              {isPt ? 'Privacidade' : 'Privacy'}
            </a>
            <button
              type="button"
              onClick={onOpenPlayer}
              className="text-amber-400 hover:text-amber-300 font-semibold transition-colors cursor-pointer"
            >
              {isPt ? 'Abrir Player Web' : 'Open Web Player'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
