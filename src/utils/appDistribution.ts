const DISTRIBUTION_URL_STORAGE_KEY = 'rivera_app_distribution_url_v1';
const LEGACY_RELEASES_STORAGE_KEY = 'rivera_promo_releases_url_v1';
const ANDROID_APK_FILENAME = 'RiveraVSPlayer-Android.apk';

export type DistributionTargetKind =
  | 'github-releases'
  | 'direct-apk-or-store'
  | 'custom-web-host';

export interface ParsedDistributionTarget {
  rawInput: string;
  normalizedUrl: string;
  androidDirectUrl: string;
  releasesPageUrl: string;
  promoSiteUrl: string;
  kind: DistributionTargetKind;
  isDirectApk: boolean;
}

export function isInternalPreviewHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local')
  ) {
    return true;
  }
  return (
    host.startsWith('ais-dev-') ||
    host.startsWith('ais-pre-') ||
    host === 'aistudio.google.com' ||
    host.endsWith('.aistudio.google.com')
  );
}

export function isAiStudioUrl(rawUrl: string): boolean {
  const clean = normalizeExternalUrl(rawUrl);
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    const host = parsed.hostname.toLowerCase();
    return (
      host.startsWith('ais-dev-') ||
      host.startsWith('ais-pre-') ||
      host === 'aistudio.google.com' ||
      host.endsWith('.aistudio.google.com')
    );
  } catch {
    return false;
  }
}

export function isRunningInPreviewEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  return isInternalPreviewHost(window.location.hostname);
}

export function normalizeExternalUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function parseDistributionTarget(rawUrl: string): ParsedDistributionTarget | null {
  const normalizedUrl = normalizeExternalUrl(rawUrl);
  if (!normalizedUrl || isAiStudioUrl(normalizedUrl)) return null;

  try {
    const parsed = new URL(normalizedUrl);
    const host = parsed.hostname.toLowerCase();
    const cleanPath = parsed.pathname.replace(/\/+$/, '');

    // GitHub repository or releases link -> derive exact direct .apk download + releases page
    if (host === 'github.com' || host === 'www.github.com') {
      const segments = cleanPath.split('/').filter(Boolean);
      if (segments.length >= 2) {
        const owner = segments[0];
        const repo = segments[1].replace(/\.git$/i, '');
        const baseRepo = `https://github.com/${owner}/${repo}`;

        if (/\.apk$/i.test(cleanPath)) {
          return {
            rawInput: rawUrl,
            normalizedUrl,
            androidDirectUrl: normalizedUrl,
            releasesPageUrl: `${baseRepo}/releases/latest`,
            promoSiteUrl: '',
            kind: 'direct-apk-or-store',
            isDirectApk: true,
          };
        }

        const isSpecificTag =
          segments[2] === 'releases' &&
          segments[3] === 'tag' &&
          Boolean(segments[4]);
        const tag = isSpecificTag ? segments[4] : '';

        return {
          rawInput: rawUrl,
          normalizedUrl,
          androidDirectUrl: tag
            ? `${baseRepo}/releases/download/${encodeURIComponent(tag)}/${ANDROID_APK_FILENAME}`
            : `${baseRepo}/releases/latest/download/${ANDROID_APK_FILENAME}`,
          releasesPageUrl: tag
            ? `${baseRepo}/releases/tag/${encodeURIComponent(tag)}`
            : `${baseRepo}/releases/latest`,
          promoSiteUrl: '',
          kind: 'github-releases',
          isDirectApk: true,
        };
      }
    }

    // Direct .apk URL or Play Store link
    const isApkFile = /\.apk$/i.test(cleanPath);
    const isPlayStore = host === 'play.google.com';
    if (isApkFile || isPlayStore) {
      return {
        rawInput: rawUrl,
        normalizedUrl,
        androidDirectUrl: normalizedUrl,
        releasesPageUrl: normalizedUrl,
        promoSiteUrl: '',
        kind: 'direct-apk-or-store',
        isDirectApk: isApkFile,
      };
    }

    // Custom hosted web/PWA app domain (Vercel, Netlify, Firebase, custom domain, etc.)
    const baseOrigin = parsed.origin;
    const isSiteHtml = /\/site\.html$/i.test(cleanPath);
    const appEntryUrl = isSiteHtml
      ? `${baseOrigin}/?install=1`
      : parsed.searchParams.has('install')
        ? parsed.toString()
        : `${baseOrigin}${cleanPath || ''}/?install=1`;

    return {
      rawInput: rawUrl,
      normalizedUrl,
      androidDirectUrl: appEntryUrl,
      releasesPageUrl: normalizedUrl,
      promoSiteUrl: `${baseOrigin}/site.html`,
      kind: 'custom-web-host',
      isDirectApk: false,
    };
  } catch {
    return null;
  }
}

export function loadSavedDistributionUrl(): string {
  try {
    const current = localStorage.getItem(DISTRIBUTION_URL_STORAGE_KEY);
    if (current) return current;
    const legacy = localStorage.getItem(LEGACY_RELEASES_STORAGE_KEY);
    if (legacy) {
      try {
        localStorage.setItem(DISTRIBUTION_URL_STORAGE_KEY, legacy);
      } catch {
        // ignore storage quota errors
      }
      return legacy;
    }
    return '';
  } catch {
    return '';
  }
}

export function saveDistributionUrl(rawUrl: string): {
  savedUrl: string;
  rejectedAiStudioUrl: boolean;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    try {
      localStorage.removeItem(DISTRIBUTION_URL_STORAGE_KEY);
      localStorage.removeItem(LEGACY_RELEASES_STORAGE_KEY);
    } catch {
      // ignore
    }
    return { savedUrl: '', rejectedAiStudioUrl: false };
  }

  if (isAiStudioUrl(trimmed)) {
    return { savedUrl: loadSavedDistributionUrl(), rejectedAiStudioUrl: true };
  }

  const normalized = normalizeExternalUrl(trimmed);
  if (!normalized) {
    return { savedUrl: loadSavedDistributionUrl(), rejectedAiStudioUrl: false };
  }

  try {
    localStorage.setItem(DISTRIBUTION_URL_STORAGE_KEY, normalized);
    localStorage.setItem(LEGACY_RELEASES_STORAGE_KEY, normalized);
  } catch {
    // ignore storage errors
  }
  return { savedUrl: normalized, rejectedAiStudioUrl: false };
}

function getEnvDistributionConfig(): {
  envAndroidApkUrl: string;
  envPublicAppUrl: string;
  envReleasesUrl: string;
} {
  const env = (import.meta.env || {}) as Record<string, string | undefined>;
  return {
    envAndroidApkUrl: (env.VITE_ANDROID_APK_URL || '').trim(),
    envPublicAppUrl: (env.VITE_PUBLIC_APP_URL || '').trim(),
    envReleasesUrl: (env.VITE_GITHUB_RELEASES_URL || '').trim(),
  };
}

export function getPublicAppOrigin(): string {
  const { envPublicAppUrl } = getEnvDistributionConfig();
  if (envPublicAppUrl) {
    const normalized = normalizeExternalUrl(envPublicAppUrl);
    if (normalized && !isAiStudioUrl(normalized)) {
      try {
        return new URL(normalized).origin;
      } catch {
        // ignore
      }
    }
  }

  if (typeof window === 'undefined') return '';
  const { protocol, origin, hostname } = window.location;
  if (protocol !== 'http:' && protocol !== 'https:') return '';
  if (isInternalPreviewHost(hostname)) return '';
  return origin;
}

export interface ResolvedDistributionLinks {
  androidInstallUrl: string;
  isDirectApkLink: boolean;
  releasesPageUrl: string;
  promoSiteUrl: string;
  configuredSourceUrl: string;
  isPreviewHost: boolean;
}

export function resolveAppDistributionLinks(overrideSavedUrl?: string): ResolvedDistributionLinks {
  const { envAndroidApkUrl, envPublicAppUrl, envReleasesUrl } = getEnvDistributionConfig();
  const savedUrl = overrideSavedUrl !== undefined ? overrideSavedUrl : loadSavedDistributionUrl();
  const configuredSourceUrl = savedUrl || envReleasesUrl || envAndroidApkUrl || envPublicAppUrl || '';

  const parsedApk = envAndroidApkUrl ? parseDistributionTarget(envAndroidApkUrl) : null;
  const parsedSaved = savedUrl ? parseDistributionTarget(savedUrl) : null;
  const parsedReleases = envReleasesUrl ? parseDistributionTarget(envReleasesUrl) : null;
  const parsedPublicApp = envPublicAppUrl ? parseDistributionTarget(envPublicAppUrl) : null;

  const publicOrigin = getPublicAppOrigin();
  const primaryTarget = parsedSaved || parsedReleases || parsedPublicApp;

  const androidInstallUrl =
    parsedApk?.androidDirectUrl ||
    primaryTarget?.androidDirectUrl ||
    (publicOrigin ? `${publicOrigin}/?install=1` : '');

  const isDirectApkLink = Boolean(
    parsedApk?.isDirectApk ||
      primaryTarget?.isDirectApk ||
      (androidInstallUrl && /\.apk(\?|$)/i.test(androidInstallUrl))
  );

  const releasesPageUrl =
    parsedSaved?.releasesPageUrl ||
    parsedReleases?.releasesPageUrl ||
    parsedApk?.releasesPageUrl ||
    '';

  const promoSiteUrl =
    parsedPublicApp?.promoSiteUrl ||
    (parsedSaved?.kind === 'custom-web-host' ? parsedSaved.promoSiteUrl : '') ||
    (publicOrigin ? `${publicOrigin}/site.html` : '');

  return {
    androidInstallUrl,
    isDirectApkLink,
    releasesPageUrl,
    promoSiteUrl,
    configuredSourceUrl,
    isPreviewHost: isRunningInPreviewEnvironment(),
  };
}
