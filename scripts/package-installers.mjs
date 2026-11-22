#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const RELEASE_DESKTOP_DIR = path.join(ROOT_DIR, 'release-desktop');
const OUT_ROOT = path.join(ROOT_DIR, 'RiveraVSPlayer-Instaladores');
const OUT_ANDROID = path.join(OUT_ROOT, 'Android');
const OUT_WINDOWS = path.join(OUT_ROOT, 'Windows');
const OUT_MAC = path.join(OUT_ROOT, 'macOS');
const OUT_ZIP = path.join(ROOT_DIR, 'RiveraVSPlayer-Instaladores.zip');

function log(msg) {
  console.log(`[pack] ${msg}`);
}

function runCommand(command, args, cwd = ROOT_DIR) {
  const res = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return res.status === 0;
}

function hasBinary(cmd) {
  try {
    const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findFilesRecursive(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFilesRecursive(fullPath, predicate, results);
    } else if (predicate(fullPath, entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function verifyOfflineDistBundle() {
  const indexHtmlPath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error('dist/index.html nao encontrado apos vite build.');
  }
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(indexHtml)) {
    throw new Error('Falha na verificacao offline: referencia externa ao Google Fonts detectada em dist/index.html.');
  }

  const assetsDir = path.join(DIST_DIR, 'assets');
  const fontFiles = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir).filter((f) => f.endsWith('.woff2'))
    : [];
  if (fontFiles.length === 0) {
    throw new Error('Falha na verificacao offline: nenhuma fonte .woff2 local embutida em dist/assets.');
  }
  log(`Verificacao offline OK (${fontFiles.length} arquivos de fonte .woff2 embutidos, 0 CDNs externas).`);
}

function buildLocalAndroidIfReady() {
  const androidDir = path.join(ROOT_DIR, 'android');
  const gradlew = process.platform === 'win32'
    ? path.join(androidDir, 'gradlew.bat')
    : path.join(androidDir, 'gradlew');

  if (!fs.existsSync(androidDir) || !fs.existsSync(gradlew) || !hasBinary('java')) {
    log('Android SDK/projeto nativo local nao inicializado neste host — pulando compilacao direta de .apk.');
    return [];
  }

  log('Sincronizando Capacitor Android (npx cap sync android)...');
  runCommand('npx', ['cap', 'sync', 'android']);
  runCommand('node', ['scripts/patch-android-gradle.mjs']);

  log('Compilando APK Android (assembleRelease)...');
  const ok = runCommand(gradlew, ['assembleRelease', '--no-daemon', '--max-workers=2'], androidDir);
  if (!ok) {
    log('Aviso: compilacao Gradle Android falhou neste host.');
    return [];
  }

  const apkDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk');
  return findFilesRecursive(apkDir, (_p, name) => name.toLowerCase().endsWith('.apk'));
}

function buildLocalDesktopIfReady() {
  const hasElectronBuilder = fs.existsSync(path.join(ROOT_DIR, 'node_modules', '.bin', 'electron-builder'))
    || fs.existsSync(path.join(ROOT_DIR, 'node_modules', '.bin', 'electron-builder.cmd'));

  if (!hasElectronBuilder) {
    log('electron-builder nao instalado em node_modules — pulando compilacao local de executavel desktop.');
    return [];
  }

  const targetFlag =
    process.platform === 'win32'
      ? '--win'
      : process.platform === 'darwin'
        ? '--mac'
        : null;

  if (!targetFlag) {
    log('Host Linux detectado: para gerar .exe e .dmg nativos sem emulador, execute este script no Windows/macOS ou via GitHub Actions.');
    return [];
  }

  log(`Compilando instalador nativo (${targetFlag}) via electron-builder...`);
  const ok = runCommand('npx', ['electron-builder', targetFlag, '--publish', 'never', '--config', 'electron-builder.yml']);
  if (!ok) {
    log(`Aviso: electron-builder (${targetFlag}) falhou neste host.`);
    return [];
  }

  return findFilesRecursive(
    RELEASE_DESKTOP_DIR,
    (_p, name) => /\.(exe|msi|dmg|pkg)$/i.test(name) || /-mac.*\.zip$/i.test(name)
  );
}

function copyMatchingArtifacts(candidates, targetDir, filterFn) {
  let count = 0;
  for (const src of candidates) {
    const fileName = path.basename(src);
    if (!filterFn(fileName)) continue;
    const dest = path.join(targetDir, fileName);
    fs.copyFileSync(src, dest);
    count += 1;
    log(`Copiado -> ${path.relative(ROOT_DIR, dest)}`);
  }
  return count;
}

function writeReadme(counts) {
  const readme = `Rivera V/S Player - Pacote Unico de Instaladores (100% Offline)
================================================================

Escolha a pasta correspondente ao seu sistema operacional:

1. Android/
   - Instale o arquivo .apk no seu celular ou tablet Android.
   - Arquivos incluidos nesta compilacao: ${counts.android}

2. Windows/
   - Execute o instalador .exe (ou a versao portable .exe) no Windows 10/11.
   - Arquivos incluidos nesta compilacao: ${counts.windows}

3. macOS/
   - Abra o arquivo .dmg (ou extraia o .app) no Mac (Apple Silicon ou Intel).
   - Arquivos incluidos nesta compilacao: ${counts.mac}

Como gerar os instaladores nativos em qualquer maquina ou automaticamente na nuvem:
- Windows (.exe): npm install --save-dev electron electron-builder && npm run package:installers
- macOS (.dmg / .app): npm install --save-dev electron electron-builder && npm run package:installers
- Android (.apk): npm install @capacitor/core @capacitor/cli @capacitor/android && npx cap add android && npx cap sync android && npm run package:installers
- Automatico nos 3 sistemas juntos: use o workflow ".github/workflows/build-installers.yml" no GitHub Actions.

Funcionamento 100% Offline:
- Todas as fontes, icones, video de abertura, engine de audio DSP e interface estao embutidos localmente.
- Suas musicas, playlists e presets ficam salvos direto no armazenamento interno (IndexedDB / LocalStorage) do aparelho.
`;
  fs.writeFileSync(path.join(OUT_ROOT, 'LEIA-ME.txt'), readme, 'utf8');
}

function createDistributionZip() {
  if (fs.existsSync(OUT_ZIP)) {
    fs.rmSync(OUT_ZIP, { force: true });
  }

  if (process.platform === 'win32') {
    const ok = runCommand('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${OUT_ROOT}' -DestinationPath '${OUT_ZIP}' -Force`,
    ]);
    if (ok) return true;
  }

  if (hasBinary('zip')) {
    const ok = runCommand('zip', ['-rq', path.basename(OUT_ZIP), path.basename(OUT_ROOT)], ROOT_DIR);
    if (ok) return true;
  }

  if (hasBinary('python3')) {
    const pyScript = [
      'import os, zipfile',
      `root = ${JSON.stringify(OUT_ROOT)}`,
      `base = ${JSON.stringify(ROOT_DIR)}`,
      `out_zip = ${JSON.stringify(OUT_ZIP)}`,
      'with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:',
      '    for folder, _, files in os.walk(root):',
      '        if not files:',
      '            rel_dir = os.path.relpath(folder, base) + "/"',
      '            zf.writestr(rel_dir, "")',
      '        for f in files:',
      '            full = os.path.join(folder, f)',
      '            zf.write(full, os.path.relpath(full, base))',
    ].join('\n');
    const ok = runCommand('python3', ['-c', pyScript], ROOT_DIR);
    if (ok) return true;
  }

  return false;
}

async function main() {
  log('1/4 Compilando bundle Web Offline-First (npm run build)...');
  if (!runCommand('npm', ['run', 'build'])) {
    process.exit(1);
  }
  verifyOfflineDistBundle();

  log('2/4 Preparando estrutura RiveraVSPlayer-Instaladores/...');
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(OUT_ANDROID, { recursive: true });
  fs.mkdirSync(OUT_WINDOWS, { recursive: true });
  fs.mkdirSync(OUT_MAC, { recursive: true });

  log('3/4 Coletando/compilando instaladores disponiveis neste host...');
  const builtApkCandidates = buildLocalAndroidIfReady();
  const builtDesktopCandidates = buildLocalDesktopIfReady();

  const existingReleaseCandidates = [
    ...builtApkCandidates,
    ...builtDesktopCandidates,
    ...findFilesRecursive(
      RELEASE_DESKTOP_DIR,
      (_p, name) => /\.(apk|exe|msi|dmg|pkg)$/i.test(name) || /-mac.*\.zip$/i.test(name)
    ),
  ];

  const uniqueCandidates = Array.from(new Set(existingReleaseCandidates));
  const androidCount = copyMatchingArtifacts(uniqueCandidates, OUT_ANDROID, (name) => /\.apk$/i.test(name));
  const windowsCount = copyMatchingArtifacts(uniqueCandidates, OUT_WINDOWS, (name) => /\.(exe|msi)$/i.test(name));
  const macCount = copyMatchingArtifacts(
    uniqueCandidates,
    OUT_MAC,
    (name) => /\.(dmg|pkg|app)$/i.test(name) || (/mac|darwin/i.test(name) && /\.zip$/i.test(name))
  );

  writeReadme({ android: androidCount, windows: windowsCount, mac: macCount });

  log('4/4 Compactando pacote unico RiveraVSPlayer-Instaladores.zip...');
  const zipped = createDistributionZip();
  if (!zipped) {
    throw new Error('Nao foi possivel compactar RiveraVSPlayer-Instaladores.zip neste ambiente.');
  }

  const zipSizeMB = (fs.statSync(OUT_ZIP).size / (1024 * 1024)).toFixed(2);
  log(`Concluido! Pacote gerado: ${path.basename(OUT_ZIP)} (${zipSizeMB} MB)`);
  log(`Resumo -> Android: ${androidCount} | Windows: ${windowsCount} | macOS: ${macCount}`);
}

main().catch((err) => {
  console.error('[pack] Erro:', err.message);
  process.exit(1);
});
