#!/usr/bin/env node
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT_DIR, 'android');
const APP_MAIN_DIR = path.join(ANDROID_DIR, 'app', 'src', 'main');
const APP_RES_DIR = path.join(APP_MAIN_DIR, 'res');

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
    ['android.enableJetifier', 'true'],
    ['android.useAndroidX', 'true'],
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

function patchVariablesGradle(varsPath) {
  if (!fs.existsSync(varsPath)) return;
  const original = fs.readFileSync(varsPath, 'utf8');
  let updated = original;

  const minSdkTargets = {
    minSdkVersion: 24,
    compileSdkVersion: 35,
    targetSdkVersion: 35,
  };

  for (const [key, minRequired] of Object.entries(minSdkTargets)) {
    const re = new RegExp(`(\\b${key}\\s*=\\s*)(\\d+)`);
    if (re.test(updated)) {
      updated = updated.replace(re, (_full, prefix, valStr) => {
        const current = Number.parseInt(valStr, 10);
        const nextVal = Number.isFinite(current) && current >= minRequired ? current : minRequired;
        return `${prefix}${nextVal}`;
      });
    }
  }

  if (updated !== original) {
    fs.writeFileSync(varsPath, updated, 'utf8');
    console.log(`[gradle-patch] SDK Android ajustado (Play Store API 35 / minSdk 24+): ${path.relative(ROOT_DIR, varsPath)}`);
  }
}

function patchAppBuildGradle(appBuildGradlePath) {
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

  // Ensure multi-ABI / density / language Play Store AAB splits & native symbol tables
  if (!updated.includes('debugSymbolLevel')) {
    updated = updated.replace(
      /(defaultConfig\s*\{)/,
      `$1\n        multiDexEnabled true\n        ndk {\n            debugSymbolLevel 'SYMBOL_TABLE'\n        }`
    );
  }

  if (!updated.includes('bundle {') && /\bandroid\s*\{/.test(updated)) {
    updated = updated.replace(
      /(\bandroid\s*\{)/,
      `$1\n    bundle {\n        language {\n            enableSplit = true\n        }\n        density {\n            enableSplit = true\n        }\n        abi {\n            enableSplit = true\n        }\n    }`
    );
  }

  if (updated !== original) {
    fs.writeFileSync(appBuildGradlePath, updated, 'utf8');
    console.log(`[gradle-patch] Configuracao de release/bundle atualizada em: ${path.relative(ROOT_DIR, appBuildGradlePath)}`);
  }
}

function upsertXmlAttribute(tagText, attrName, attrValue) {
  const attrRegex = new RegExp(`\\b${attrName}\\s*=\\s*"[^"]*"`);
  if (attrRegex.test(tagText)) {
    return tagText.replace(attrRegex, `${attrName}="${attrValue}"`);
  }
  return tagText.replace(/>$/, `\n        ${attrName}="${attrValue}">`);
}

function patchAndroidManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return;
  const original = fs.readFileSync(manifestPath, 'utf8');
  let updated = original;

  const declarationsToAdd = [
    '<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />',
    '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    '<uses-permission android:name="android.permission.WAKE_LOCK" />',
    '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
    '<uses-feature android:name="android.hardware.touchscreen" android:required="false" />',
    '<uses-feature android:name="android.hardware.audio.output" android:required="false" />',
  ];

  const missing = declarationsToAdd.filter((decl) => {
    const nameMatch = decl.match(/android:name="([^"]+)"/);
    return nameMatch && !updated.includes(nameMatch[1]);
  });

  if (missing.length > 0 && updated.includes('<application')) {
    updated = updated.replace(
      /<application\b/,
      `${missing.map((m) => `    ${m}`).join('\n')}\n\n    <application`
    );
  }

  // Harden <application> for Play Store tablets, foldables, Chromebooks, security, and Android 15 back handling
  updated = updated.replace(/<application\b[\s\S]*?>/, (appTag) => {
    let next = appTag;
    next = upsertXmlAttribute(next, 'android:hardwareAccelerated', 'true');
    next = upsertXmlAttribute(next, 'android:resizeableActivity', 'true');
    next = upsertXmlAttribute(next, 'android:supportsRtl', 'true');
    next = upsertXmlAttribute(next, 'android:usesCleartextTraffic', 'false');
    next = upsertXmlAttribute(next, 'android:enableOnBackInvokedCallback', 'false');
    next = upsertXmlAttribute(next, 'android:appCategory', 'audio');
    return next;
  });

  // Preserve WebView audio across phone rotation, foldable unfold, and Chromebook window resize
  updated = updated.replace(/<activity\b[\s\S]*?>/, (actTag) => {
    let next = actTag;
    next = upsertXmlAttribute(
      next,
      'android:configChanges',
      'orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|density|navigation'
    );
    next = upsertXmlAttribute(next, 'android:resizeableActivity', 'true');
    next = upsertXmlAttribute(next, 'android:exported', 'true');
    return next;
  });

  if (updated !== original) {
    fs.writeFileSync(manifestPath, updated, 'utf8');
    console.log(`[gradle-patch] AndroidManifest atualizado para Play Store e multi-dispositivos: ${path.relative(ROOT_DIR, manifestPath)}`);
  }
}

function patchFilePathsXml() {
  const xmlDir = path.join(APP_RES_DIR, 'xml');
  const filePathsPath = path.join(xmlDir, 'file_paths.xml');
  fs.mkdirSync(xmlDir, { recursive: true });

  if (!fs.existsSync(filePathsPath)) {
    const content = `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-path name="my_images" path="." />
    <cache-path name="rivera_exports" path="exports/" />
    <files-path name="rivera_files" path="." />
</paths>
`;
    fs.writeFileSync(filePathsPath, content, 'utf8');
    console.log('[gradle-patch] file_paths.xml criado com suporte a exportacao de audio.');
    return;
  }

  const original = fs.readFileSync(filePathsPath, 'utf8');
  if (!original.includes('rivera_exports')) {
    const updated = original.replace(
      /<\/paths>/,
      '    <cache-path name="rivera_exports" path="exports/" />\n</paths>'
    );
    if (updated !== original) {
      fs.writeFileSync(filePathsPath, updated, 'utf8');
      console.log('[gradle-patch] file_paths.xml atualizado com cache-path para exportacao.');
    }
  }
}

function patchThemeAndLauncherXml() {
  const valuesDir = path.join(APP_RES_DIR, 'values');
  fs.mkdirSync(valuesDir, { recursive: true });

  const bgXmlPath = path.join(valuesDir, 'ic_launcher_background.xml');
  const bgContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#000000</color>
</resources>
`;
  fs.writeFileSync(bgXmlPath, bgContent, 'utf8');

  const colorsPath = path.join(valuesDir, 'colors.xml');
  const colorsContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#000000</color>
    <color name="colorPrimaryDark">#000000</color>
    <color name="colorAccent">#F59E0B</color>
</resources>
`;
  fs.writeFileSync(colorsPath, colorsContent, 'utf8');

  const anydpiDir = path.join(APP_RES_DIR, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpiDir, { recursive: true });

  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptiveXml, 'utf8');
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptiveXml, 'utf8');

  const stylesPath = path.join(valuesDir, 'styles.xml');
  if (fs.existsSync(stylesPath)) {
    const original = fs.readFileSync(stylesPath, 'utf8');
    let updated = original;
    if (!updated.includes('android:windowBackground') && updated.includes('AppTheme.NoActionBarLaunch')) {
      updated = updated.replace(
        /(<style\s+name="AppTheme\.NoActionBarLaunch"[^>]*>)/,
        '$1\n        <item name="android:windowBackground">@android:color/black</item>\n        <item name="android:statusBarColor">@android:color/black</item>\n        <item name="android:navigationBarColor">@android:color/black</item>'
      );
    }
    if (updated !== original) {
      fs.writeFileSync(stylesPath, updated, 'utf8');
      console.log('[gradle-patch] styles.xml atualizado com splash/barras em preto absoluto.');
    }
  }
}

function generateAndroidIcons() {
  const launcherSrc = path.join(ROOT_DIR, 'public', 'icon-512-v12.png');
  const maskableSrc = path.join(ROOT_DIR, 'public', 'icon-maskable-512-v12.png');
  const fgSource = fs.existsSync(maskableSrc) ? maskableSrc : launcherSrc;

  if (!fs.existsSync(launcherSrc)) {
    console.log('[gradle-patch] Aviso: public/icon-512-v12.png nao encontrado; mantendo icones padrao.');
    return;
  }

  const densities = [
    { dir: 'mipmap-mdpi', icon: 48, fg: 108 },
    { dir: 'mipmap-hdpi', icon: 72, fg: 162 },
    { dir: 'mipmap-xhdpi', icon: 96, fg: 216 },
    { dir: 'mipmap-xxhdpi', icon: 144, fg: 324 },
    { dir: 'mipmap-xxxhdpi', icon: 192, fg: 432 },
  ];

  // Try Python3 + Pillow first for crisp Lanczos scaling
  const pyCode = `
import os, sys
from PIL import Image
launcher_src, fg_src, res_dir = sys.argv[1], sys.argv[2], sys.argv[3]
densities = [("mipmap-mdpi", 48, 108), ("mipmap-hdpi", 72, 162), ("mipmap-xhdpi", 96, 216), ("mipmap-xxhdpi", 144, 324), ("mipmap-xxxhdpi", 192, 432)]
base_img = Image.open(launcher_src).convert("RGBA")
fg_img = Image.open(fg_src).convert("RGBA")
for folder, icon_px, fg_px in densities:
    out_dir = os.path.join(res_dir, folder)
    os.makedirs(out_dir, exist_ok=True)
    resized_icon = base_img.resize((icon_px, icon_px), Image.Resampling.LANCZOS)
    resized_icon.save(os.path.join(out_dir, "ic_launcher.png"), "PNG")
    resized_icon.save(os.path.join(out_dir, "ic_launcher_round.png"), "PNG")
    # Adaptive icon safe zone: render artwork at ~66% inside a black/transparent 108dp canvas
    canvas = Image.new("RGBA", (fg_px, fg_px), (0, 0, 0, 0))
    inner_px = int(round(fg_px * 0.68))
    inner = fg_img.resize((inner_px, inner_px), Image.Resampling.LANCZOS)
    offset = (fg_px - inner_px) // 2
    canvas.paste(inner, (offset, offset), inner)
    canvas.save(os.path.join(out_dir, "ic_launcher_foreground.png"), "PNG")
`;

  const pyRes = spawnSync('python3', ['-c', pyCode, launcherSrc, fgSource, APP_RES_DIR], {
    stdio: 'pipe',
  });
  if (pyRes.status === 0) {
    console.log('[gradle-patch] Icones Android (ic_launcher + Adaptive Icon) gerados com Pillow.');
    return;
  }

  // Fallback to ImageMagick `convert` if available
  const imCheck = spawnSync('convert', ['-version'], { stdio: 'ignore' });
  if (imCheck.status === 0) {
    for (const d of densities) {
      const outDir = path.join(APP_RES_DIR, d.dir);
      fs.mkdirSync(outDir, { recursive: true });
      spawnSync('convert', [launcherSrc, '-resize', `${d.icon}x${d.icon}`, path.join(outDir, 'ic_launcher.png')]);
      spawnSync('convert', [launcherSrc, '-resize', `${d.icon}x${d.icon}`, path.join(outDir, 'ic_launcher_round.png')]);
      const innerPx = Math.round(d.fg * 0.68);
      spawnSync('convert', [
        fgSource,
        '-resize',
        `${innerPx}x${innerPx}`,
        '-background',
        'none',
        '-gravity',
        'center',
        '-extent',
        `${d.fg}x${d.fg}`,
        path.join(outDir, 'ic_launcher_foreground.png'),
      ]);
    }
    console.log('[gradle-patch] Icones Android (ic_launcher + Adaptive Icon) gerados com ImageMagick.');
    return;
  }

  // Last resort copy into xxxhdpi so icon assets exist
  const xxxDir = path.join(APP_RES_DIR, 'mipmap-xxxhdpi');
  fs.mkdirSync(xxxDir, { recursive: true });
  fs.copyFileSync(launcherSrc, path.join(xxxDir, 'ic_launcher.png'));
  fs.copyFileSync(launcherSrc, path.join(xxxDir, 'ic_launcher_round.png'));
  fs.copyFileSync(fgSource, path.join(xxxDir, 'ic_launcher_foreground.png'));
  console.log('[gradle-patch] Icones copiados em mipmap-xxxhdpi (Pillow/ImageMagick indisponiveis neste host).');
}

function injectNativeAndroidBridge() {
  const javaDir = path.join(APP_MAIN_DIR, 'java', 'com', 'riveravs', 'player');
  if (!fs.existsSync(javaDir)) {
    fs.mkdirSync(javaDir, { recursive: true });
  }

  const bridgePath = path.join(javaDir, 'RiveraAndroidBridge.java');
  const bridgeJava = `package com.riveravs.player;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class RiveraAndroidBridge {
    private final Activity activity;

    public RiveraAndroidBridge(Activity activity) {
        this.activity = activity;
    }

    private String sanitizeWavFileName(String rawName) {
        String base = rawName == null ? "RiveraVS_Track.wav" : rawName.trim();
        base = base.replaceAll("[^\\\\p{L}\\\\p{N}._ -]+", "_");
        if (base.isEmpty()) {
            base = "RiveraVS_Track.wav";
        }
        if (!base.toLowerCase().endsWith(".wav")) {
            base = base + ".wav";
        }
        return base;
    }

    @JavascriptInterface
    public void setKeepScreenOn(final boolean enabled) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (enabled) {
                    activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            }
        });
    }

    @JavascriptInterface
    public boolean saveWavFile(String base64Data, String fileName) {
        if (base64Data == null || base64Data.isEmpty()) return false;
        String safeName = sanitizeWavFileName(fileName);

        try {
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = activity.getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                values.put(MediaStore.Downloads.MIME_TYPE, "audio/wav");
                values.put(
                    MediaStore.Downloads.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/RiveraVSPlayer"
                );
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return false;

                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) return false;
                    out.write(bytes);
                    out.flush();
                }

                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
                return true;
            }

            File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) {
                dir = new File(activity.getFilesDir(), "exports");
            }
            if (!dir.exists() && !dir.mkdirs()) {
                return false;
            }
            File outFile = new File(dir, safeName);
            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                fos.write(bytes);
                fos.flush();
            }
            MediaScannerConnection.scanFile(
                activity,
                new String[] { outFile.getAbsolutePath() },
                new String[] { "audio/wav" },
                null
            );
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean shareWavFile(String base64Data, String fileName) {
        if (base64Data == null || base64Data.isEmpty()) return false;
        String safeName = sanitizeWavFileName(fileName);

        try {
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
            File exportDir = new File(activity.getCacheDir(), "exports");
            if (!exportDir.exists() && !exportDir.mkdirs()) {
                return false;
            }
            File outFile = new File(exportDir, safeName);
            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                fos.write(bytes);
                fos.flush();
            }

            Uri uri = FileProvider.getUriForFile(
                activity,
                activity.getPackageName() + ".fileprovider",
                outFile
            );

            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("audio/wav");
            shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, safeName);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(shareIntent, safeName);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(chooser);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
`;
  fs.writeFileSync(bridgePath, bridgeJava, 'utf8');

  const mainActivityPath = path.join(javaDir, 'MainActivity.java');
  const mainActivityJava = `package com.riveravs.player;

import android.graphics.Color;
import android.media.AudioManager;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean riveraBridgeAttached = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        configureSystemBarsAndInsets();
        attachRiveraBridge();
    }

    @Override
    public void onStart() {
        super.onStart();
        attachRiveraBridge();
    }

    private void configureSystemBarsAndInsets() {
        Window window = getWindow();
        if (window != null) {
            View decorView = window.getDecorView();
            decorView.setBackgroundColor(Color.BLACK);
            WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(window, decorView);
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }

        View contentView = findViewById(android.R.id.content);
        if (contentView != null) {
            contentView.setBackgroundColor(Color.BLACK);
            ViewCompat.setOnApplyWindowInsetsListener(contentView, (view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
        }
    }

    private void attachRiveraBridge() {
        if (riveraBridgeAttached || getBridge() == null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.addJavascriptInterface(new RiveraAndroidBridge(this), "RiveraAndroidBridge");
        riveraBridgeAttached = true;
    }
}
`;
  fs.writeFileSync(mainActivityPath, mainActivityJava, 'utf8');
  console.log('[gradle-patch] RiveraAndroidBridge e MainActivity configurados (STREAM_MUSIC, KeepScreenOn, WAV Export/Share, Safe Insets).');
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

  patchVariablesGradle(path.join(ANDROID_DIR, 'variables.gradle'));
  patchAppBuildGradle(path.join(ANDROID_DIR, 'app', 'build.gradle'));
  patchGradleProperties(path.join(ANDROID_DIR, 'gradle.properties'));
  patchAndroidManifest(path.join(APP_MAIN_DIR, 'AndroidManifest.xml'));
  patchFilePathsXml();
  patchThemeAndLauncherXml();
  generateAndroidIcons();
  injectNativeAndroidBridge();
}

main();
