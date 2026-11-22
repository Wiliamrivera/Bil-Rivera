#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT_DIR, 'android');

const MIRROR_URL = 'https://maven-central.storage-download.googleapis.com/maven2/';
const MIRROR_LINE = `maven { url '${MIRROR_URL}' }`;

function patchRepositoriesInContent(content) {
  const lines = content.split(/\r?\n/);
  const out = [];
  let inRepoBlock = false;
  let repoBraceDepth = 0;
  let blockSawGoogle = false;
  let blockSawMirror = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inRepoBlock) {
      if (/\brepositories\s*\{/.test(trimmed) && !trimmed.startsWith('//')) {
        inRepoBlock = true;
        repoBraceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        blockSawGoogle = /\bgoogle\s*\(\s*\)/.test(line);
        blockSawMirror = line.includes(MIRROR_URL);
        out.push(line);
        if (repoBraceDepth <= 0) {
          inRepoBlock = false;
        }
        continue;
      }
      out.push(line);
      continue;
    }

    const indent = (line.match(/^(\s*)/) || ['', '        '])[1];

    if (/\bgoogle\s*\(\s*\)/.test(trimmed)) {
      blockSawGoogle = true;
    }
    if (line.includes(MIRROR_URL)) {
      blockSawMirror = true;
    }

    if (/\bmavenCentral\s*\(\s*\)/.test(trimmed) && !trimmed.startsWith('//')) {
      if (!blockSawGoogle) {
        out.push(`${indent}google()`);
        blockSawGoogle = true;
      }
      if (!blockSawMirror) {
        out.push(`${indent}${MIRROR_LINE}`);
        blockSawMirror = true;
      }
    }

    out.push(line);
    repoBraceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (repoBraceDepth <= 0) {
      inRepoBlock = false;
    }
  }

  return out.join('\n');
}

function patchGradleFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const original = fs.readFileSync(filePath, 'utf8');
  const updated = patchRepositoriesInContent(original);
  if (updated !== original) {
    fs.writeFileSync(filePath, updated, 'utf8');
    console.log(`[gradle-patch] Repositorios Maven atualizados: ${path.relative(ROOT_DIR, filePath)}`);
    return true;
  }
  return false;
}

function patchGradleProperties(propsPath) {
  const existing = fs.existsSync(propsPath) ? fs.readFileSync(propsPath, 'utf8') : '';
  const desired = new Map([
    ['org.gradle.daemon', 'false'],
    ['org.gradle.workers.max', '2'],
    ['systemProp.org.gradle.internal.repository.max.tentatives', '6'],
    ['systemProp.org.gradle.internal.repository.initial.backoff', '2000'],
    ['systemProp.org.gradle.internal.http.connectionTimeout', '60000'],
    ['systemProp.org.gradle.internal.http.socketTimeout', '60000'],
  ]);

  const lines = existing ? existing.split(/\r?\n/) : [];
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^\s*([^#=\s]+)\s*=/);
    if (match && desired.has(match[1])) {
      const key = match[1];
      seen.add(key);
      return `${key}=${desired.get(key)}`;
    }
    return line;
  });

  for (const [key, val] of desired.entries()) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${val}`);
    }
  }

  const nextContent = `${nextLines.join('\n').replace(/\n+$/, '')}\n`;
  if (nextContent !== existing) {
    fs.writeFileSync(propsPath, nextContent, 'utf8');
    console.log(`[gradle-patch] Propriedades Gradle configuradas: ${path.relative(ROOT_DIR, propsPath)}`);
  }
}

function patchAndroidManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return;
  const original = fs.readFileSync(manifestPath, 'utf8');
  let updated = original;

  const permissionsToAdd = [
    '<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />',
    '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
  ];

  const missing = permissionsToAdd.filter((perm) => {
    const nameMatch = perm.match(/android:name="([^"]+)"/);
    return nameMatch && !updated.includes(nameMatch[1]);
  });

  if (missing.length > 0 && updated.includes('<application')) {
    updated = updated.replace(
      /<application\b/,
      `${missing.map((m) => `    ${m}`).join('\n')}\n\n    <application`
    );
  }

  if (updated !== original) {
    fs.writeFileSync(manifestPath, updated, 'utf8');
    console.log(`[gradle-patch] Permissoes de audio atualizadas: ${path.relative(ROOT_DIR, manifestPath)}`);
  }
}

function patchAppVersion(appBuildGradlePath) {
  if (!fs.existsSync(appBuildGradlePath)) return;
  const original = fs.readFileSync(appBuildGradlePath, 'utf8');
  let updated = original;

  const pkgPath = path.join(ROOT_DIR, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version && typeof pkg.version === 'string') {
      updated = updated.replace(
        /(\bversionName(?:\s*=\s*|\s+))(["'])[^"']*\2/,
        `$1"${pkg.version}"`
      );
    }
  }

  const rawCode = process.env.ANDROID_VERSION_CODE;
  const parsedCode = rawCode ? Number.parseInt(rawCode, 10) : NaN;
  if (Number.isInteger(parsedCode) && parsedCode > 0) {
    updated = updated.replace(/(\bversionCode(?:\s*=\s*|\s+))\d+/, `$1${parsedCode}`);
  }

  if (updated !== original) {
    fs.writeFileSync(appBuildGradlePath, updated, 'utf8');
    console.log(`[gradle-patch] Versao do app atualizada em: ${path.relative(ROOT_DIR, appBuildGradlePath)}`);
  }
}

function main() {
  if (!fs.existsSync(ANDROID_DIR)) {
    console.log('[gradle-patch] Pasta android/ nao encontrada ainda; nada a ajustar.');
    return;
  }

  const candidates = [
    path.join(ANDROID_DIR, 'build.gradle'),
    path.join(ANDROID_DIR, 'app', 'build.gradle'),
    path.join(ANDROID_DIR, 'settings.gradle'),
    path.join(ANDROID_DIR, 'capacitor-cordova-android-plugins', 'build.gradle'),
    path.join(ROOT_DIR, 'node_modules', '@capacitor', 'android', 'capacitor', 'build.gradle'),
  ];

  for (const file of candidates) {
    patchGradleFile(file);
  }

  patchAppVersion(path.join(ANDROID_DIR, 'app', 'build.gradle'));
  patchGradleProperties(path.join(ANDROID_DIR, 'gradle.properties'));
  patchAndroidManifest(path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml'));
}

main();
