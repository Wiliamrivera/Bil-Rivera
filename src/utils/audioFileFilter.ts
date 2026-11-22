export const AUDIO_EXT_RE =
  /\.(mp3|wav|m4a|m4b|mp4|m4p|m4r|ogg|oga|opus|flac|aac|webm|wma|aiff|aif|aifc|caf|mpeg|mpg|mp2|mp1|3gp|3gpp|amr|awb|ac3|eac3|alac|wv|ape|spx)$/i;

const OBVIOUS_NON_AUDIO_EXT_RE =
  /\.(jpe?g|png|gif|webp|bmp|heic|heif|svg|ico|pdf|txt|md|rtf|doc|docx|xls|xlsx|ppt|pptx|csv|json|xml|html?|zip|rar|7z|tar|gz|apk|exe|msi|dmg|app|js|ts|css)$/i;

const EXTRA_AUDIO_MIMES = new Set([
  'application/ogg',
  'application/x-ogg',
  'application/mp4',
  'video/mp4',
  'video/webm',
  'video/3gpp',
  'video/3gpp2',
  'application/vnd.apple.mpegurl',
]);

const EXT_TO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mpg: 'audio/mpeg',
  mp2: 'audio/mpeg',
  mp1: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  m4p: 'audio/mp4',
  m4r: 'audio/mp4',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  aac: 'audio/aac',
  webm: 'audio/webm',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  aifc: 'audio/aiff',
  caf: 'audio/x-caf',
  '3gp': 'audio/3gpp',
  '3gpp': 'audio/3gpp',
  amr: 'audio/amr',
  awb: 'audio/amr-wb',
};

export function inferAudioMimeType(fileName: string, currentType?: string): string {
  if (currentType && currentType !== 'application/octet-stream') {
    return currentType;
  }
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = match ? match[1] : '';
  return EXT_TO_MIME[ext] || 'audio/mpeg';
}

export function isAudioFileSync(file: File): boolean {
  const mime = (file.type || '').toLowerCase().split(';')[0].trim();
  if (mime.startsWith('audio/') || EXTRA_AUDIO_MIMES.has(mime)) {
    return true;
  }
  if (AUDIO_EXT_RE.test(file.name)) {
    return true;
  }
  return false;
}

function hasAudioMagicSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;

  // ID3v2 tag (MP3/AAC/WAV/FLAC)
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  // MPEG ADTS / MP3 frame sync (0xFF 0xE0..0xFF)
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return true;
  // RIFF (WAV)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
  // fLaC
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return true;
  // OggS
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return true;
  // FORM (AIFF)
  if (bytes[0] === 0x46 && bytes[1] === 0x4f && bytes[2] === 0x52 && bytes[3] === 0x4d) return true;
  // ADIF (AAC)
  if (bytes[0] === 0x41 && bytes[1] === 0x44 && bytes[2] === 0x49 && bytes[3] === 0x46) return true;
  // #!AMR
  if (bytes[0] === 0x23 && bytes[1] === 0x21 && bytes[2] === 0x41 && bytes[3] === 0x4d) return true;
  // WebM / Matroska EBML
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true;
  // ASF / WMA
  if (bytes[0] === 0x30 && bytes[1] === 0x26 && bytes[2] === 0xb2 && bytes[3] === 0x75) return true;
  // MP4 / M4A ftyp box at offset 4
  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return true;
  }
  // CoreAudio caff
  if (bytes[0] === 0x63 && bytes[1] === 0x61 && bytes[2] === 0x66 && bytes[3] === 0x66) return true;

  return false;
}

/**
 * Filters selected files cleanly while accommodating Android WebView / ContentProvider
 * files that sometimes arrive with empty MIME types or missing file extensions.
 */
export async function filterPlayableAudioFiles(files: File[]): Promise<File[]> {
  const result: File[] = [];
  for (const file of files) {
    if (isAudioFileSync(file)) {
      result.push(file);
      continue;
    }
    const name = file.name || '';
    if (OBVIOUS_NON_AUDIO_EXT_RE.test(name)) {
      continue;
    }
    const mime = (file.type || '').toLowerCase().split(';')[0].trim();
    const isAmbiguous =
      !mime ||
      mime === 'application/octet-stream' ||
      mime.startsWith('video/') ||
      !name.includes('.');

    if (!isAmbiguous) continue;

    try {
      const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
      if (hasAudioMagicSignature(header) || (!name.includes('.') && file.size > 1024)) {
        result.push(file);
      }
    } catch {
      // If Android content:// File rejects slice() before full read, keep if non-empty extensionless/generic
      if (!name.includes('.') || mime === 'application/octet-stream') {
        result.push(file);
      }
    }
  }
  return result;
}

/**
 * Materializes a File (which on Android WebView may wrap a transient content:// grant)
 * into a standalone in-memory Blob before saving into IndexedDB.
 */
export async function materializeAudioBlob(file: File): Promise<Blob> {
  const resolvedMime = inferAudioMimeType(file.name, file.type);
  try {
    const buffer = await file.arrayBuffer();
    return new Blob([buffer], { type: resolvedMime });
  } catch {
    return file;
  }
}
