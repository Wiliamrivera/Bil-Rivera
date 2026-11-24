export const PITCH_WORKLET_NAME = 'rivera-vs-pitch-shifter';

export const PITCH_WORKLET_CODE = `
class RiveraPitchShifterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.activeId = '';
    this.ch0 = null;
    this.ch1 = null;
    this.srcLen = 0;
    this.srcRate = 48000;

    // Pre-staged next track for 0.0 ms auto-advance and instant Next switching
    this.nextId = '';
    this.nextCh0 = null;
    this.nextCh1 = null;
    this.nextLen = 0;
    this.nextRate = 48000;
    this.nextSpeed = 1;
    this.nextSemitones = 0;
    this.autoAdvance = false;

    this.isPlaying = false;
    this.playPos = 0;
    this.readPos = 0;
    this.oldReadPos = 0;

    this.speed = 1;
    this.targetSpeed = 1;
    this.semitones = 0;
    this.targetSemitones = 0;
    this.loopEnabled = false;
    this.loopASample = 0;
    this.loopBSample = 0;

    this.overlapLen = 1024;
    this.splicePeriod = 2560;
    this.seekHalf = 768;
    this.corrLen = 1024;

    this.spliceCounter = 0;
    this.xfadePos = -1;
    this.xfadeTotal = 1024;
    this.xfadePitchStep = 1;

    this.wasBypassed = true;
    this.bypassFade = 0;
    this.bypassFadeTotal = 384;
    this.bypassOldStep = 1;
    this.lastPitchStep = 1;
    this.fadeInSamples = 0;
    this.fadeInTotal = 384;

    // Anti-click de-zipper envelopes for pause & seek
    this.pauseFade = 0;
    this.pauseFadeTotal = 384;
    this.pauseAfterFade = false;
    this.pendingSeekAfterPause = -1;

    this.seekXfade = 0;
    this.seekXfadeTotal = 384;
    this.seekOldPos = 0;
    this.seekOldStep = 1;

    this.endedSent = false;
    this.posReportCounter = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'load') {
        this.activeId = msg.id || '';
        this.ch0 = msg.ch0;
        this.ch1 = msg.ch1 || msg.ch0;
        this.srcLen = this.ch0 ? this.ch0.length : 0;
        this.srcRate = msg.sampleRate || sampleRate;
        if (this.nextId && this.nextId === this.activeId) {
          this.nextId = '';
          this.nextCh0 = null;
          this.nextCh1 = null;
          this.nextLen = 0;
        }
        const start = Math.max(0, Math.min(Math.max(0, this.srcLen - 1), msg.startSample || 0));
        this.playPos = start;
        this.readPos = start;
        this.oldReadPos = start;
        this.isPlaying = false;
        this.xfadePos = -1;
        this.spliceCounter = 0;
        this.bypassFade = 0;
        this.speed = this.targetSpeed;
        this.semitones = this.targetSemitones;
        this.wasBypassed = Math.abs(this.speed - 1) < 0.0002 && Math.abs(this.semitones) < 0.001;
        this.pauseFade = 0;
        this.pauseAfterFade = false;
        this.pendingSeekAfterPause = -1;
        this.seekXfade = 0;
        this.endedSent = false;
      } else if (msg.type === 'stageNext') {
        if (msg.id && msg.ch0 && msg.id !== this.activeId) {
          this.nextId = msg.id;
          this.nextCh0 = msg.ch0;
          this.nextCh1 = msg.ch1 || msg.ch0;
          this.nextLen = msg.ch0.length;
          this.nextRate = msg.sampleRate || sampleRate;
          this.nextSpeed = typeof msg.speed === 'number' ? Math.max(0.25, Math.min(2.5, msg.speed)) : 1;
          this.nextSemitones = typeof msg.semitones === 'number' ? Math.max(-12, Math.min(12, msg.semitones)) : 0;
        }
      } else if (msg.type === 'clearStaged') {
        this.nextId = '';
        this.nextCh0 = null;
        this.nextCh1 = null;
        this.nextLen = 0;
      } else if (msg.type === 'playStaged') {
        if (this.nextId && this.nextId === msg.id && this.nextCh0 && this.nextLen > 1) {
          this.activeId = this.nextId;
          this.ch0 = this.nextCh0;
          this.ch1 = this.nextCh1 || this.nextCh0;
          this.srcLen = this.nextLen;
          this.srcRate = this.nextRate || sampleRate;
          if (typeof msg.speed === 'number') this.targetSpeed = Math.max(0.25, Math.min(2.5, msg.speed));
          else this.targetSpeed = this.nextSpeed;
          if (typeof msg.semitones === 'number') this.targetSemitones = Math.max(-12, Math.min(12, msg.semitones));
          else this.targetSemitones = this.nextSemitones;
          this.speed = this.targetSpeed;
          this.semitones = this.targetSemitones;

          this.nextId = '';
          this.nextCh0 = null;
          this.nextCh1 = null;
          this.nextLen = 0;

          const start = Math.max(0, Math.min(Math.max(0, this.srcLen - 1), msg.fromSample || 0));
          this.playPos = start;
          this.readPos = start;
          this.oldReadPos = start;
          this.xfadePos = -1;
          this.spliceCounter = 0;
          this.bypassFade = 0;
          this.wasBypassed = Math.abs(this.speed - 1) < 0.0002 && Math.abs(this.semitones) < 0.001;
          this.pauseFade = 0;
          this.pauseAfterFade = false;
          this.pendingSeekAfterPause = -1;
          this.seekXfade = 0;
          this.fadeInTotal = 192;
          this.fadeInSamples = 192;
          this.endedSent = false;
          this.isPlaying = true;
        }
      } else if (msg.type === 'play') {
        if (typeof msg.fromSample === 'number' && this.srcLen > 0) {
          const s = Math.max(0, Math.min(this.srcLen - 1, msg.fromSample));
          this.playPos = s;
          this.readPos = s;
          this.oldReadPos = s;
        }
        this.speed = this.targetSpeed;
        this.semitones = this.targetSemitones;
        this.wasBypassed = Math.abs(this.speed - 1) < 0.0002 && Math.abs(this.semitones) < 0.001;
        this.xfadePos = -1;
        this.spliceCounter = 0;
        this.bypassFade = 0;
        this.pauseFade = 0;
        this.pauseAfterFade = false;
        this.pendingSeekAfterPause = -1;
        this.seekXfade = 0;
        this.fadeInTotal = 384;
        this.fadeInSamples = 384;
        this.endedSent = false;
        this.isPlaying = true;
      } else if (msg.type === 'pause') {
        const hasSeek = typeof msg.seekSample === 'number' && this.srcLen > 0;
        const seekTarget = hasSeek ? Math.max(0, Math.min(this.srcLen - 1, msg.seekSample)) : -1;
        if (this.isPlaying && this.ch0 && this.srcLen > 1 && !this.pauseAfterFade) {
          this.pauseFadeTotal = 384;
          this.pauseFade = 384;
          this.pauseAfterFade = true;
          this.pendingSeekAfterPause = seekTarget;
        } else {
          this.isPlaying = false;
          this.pauseAfterFade = false;
          this.pauseFade = 0;
          if (seekTarget >= 0) {
            this.playPos = seekTarget;
            this.readPos = seekTarget;
            this.oldReadPos = seekTarget;
            this.xfadePos = -1;
            this.spliceCounter = 0;
          }
          this.pendingSeekAfterPause = -1;
        }
      } else if (msg.type === 'seek') {
        if (this.srcLen > 0) {
          const s = Math.max(0, Math.min(this.srcLen - 1, msg.sample || 0));
          if (this.isPlaying && !this.pauseAfterFade) {
            const srRatioNow = this.srcRate / sampleRate;
            this.seekOldPos = this.wasBypassed ? this.playPos : this.readPos;
            this.seekOldStep = this.wasBypassed
              ? srRatioNow
              : Math.pow(2, this.semitones / 12) * srRatioNow;
            this.seekXfadeTotal = 384;
            this.seekXfade = 384;
          } else {
            this.seekXfade = 0;
            this.fadeInTotal = 384;
            this.fadeInSamples = 384;
          }
          this.playPos = s;
          this.readPos = s;
          this.oldReadPos = s;
          this.xfadePos = -1;
          this.spliceCounter = 0;
          this.bypassFade = 0;
          this.endedSent = false;
        }
      } else if (msg.type === 'params') {
        if (typeof msg.speed === 'number') this.targetSpeed = Math.max(0.25, Math.min(2.5, msg.speed));
        if (typeof msg.semitones === 'number') this.targetSemitones = Math.max(-12, Math.min(12, msg.semitones));
        if (!this.isPlaying) {
          this.speed = this.targetSpeed;
          this.semitones = this.targetSemitones;
        }
        if (typeof msg.autoAdvance === 'boolean') this.autoAdvance = msg.autoAdvance;
        if (typeof msg.nextSpeed === 'number') this.nextSpeed = Math.max(0.25, Math.min(2.5, msg.nextSpeed));
        if (typeof msg.nextSemitones === 'number') this.nextSemitones = Math.max(-12, Math.min(12, msg.nextSemitones));
        this.loopEnabled = Boolean(msg.loopEnabled);
        this.loopASample = Math.max(0, msg.loopASample || 0);
        this.loopBSample = Math.max(0, msg.loopBSample || 0);
      }
    };
  }

  cubicRead(buf, pos) {
    const len = this.srcLen;
    if (len <= 0) return 0;
    if (pos <= 0) return buf[0];
    if (pos >= len - 1) return buf[len - 1];
    const i1 = Math.floor(pos);
    const t = pos - i1;
    if (t < 1e-5) return buf[i1];
    const i0 = i1 > 0 ? i1 - 1 : 0;
    const i2 = i1 + 1 < len ? i1 + 1 : len - 1;
    const i3 = i1 + 2 < len ? i1 + 2 : len - 1;
    const y0 = buf[i0];
    const y1 = buf[i1];
    const y2 = buf[i2];
    const y3 = buf[i3];
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + y1;
  }

  scoreCand(candCenter, oldPos, pitchStep, stride) {
    const c0 = this.ch0;
    const c1 = this.ch1;
    const len = this.srcLen;
    let dot = 0;
    let normB = 1e-9;
    let normA = 1e-9;
    for (let k = 0; k < this.corrLen; k += stride) {
      const idxA = Math.floor(oldPos + k * pitchStep);
      const idxB = Math.floor(candCenter + k * pitchStep);
      if (idxA < 0 || idxA >= len || idxB < 0 || idxB >= len) break;
      const a0 = c0[idxA];
      const a1 = c1[idxA];
      const b0 = c0[idxB];
      const b1 = c1[idxB];
      dot += a0 * b0 + a1 * b1;
      normA += a0 * a0 + a1 * a1;
      normB += b0 * b0 + b1 * b1;
    }
    if (normA < 1e-6 && normB < 1e-6) return 0.99;
    if (normA < 1e-7 || normB < 1e-7) return -1;
    return dot / Math.sqrt(normA * normB);
  }

  findBestAnchor(targetCenter, oldPos, pitchStep) {
    const maxSafe = Math.max(0, this.srcLen - Math.ceil(this.overlapLen * pitchStep) - 4);
    const minC = Math.max(0, Math.floor(targetCenter - this.seekHalf));
    const maxC = Math.min(maxSafe, Math.floor(targetCenter + this.seekHalf));
    if (maxC <= minC) return Math.max(0, Math.min(maxSafe, targetCenter));

    let bestPos = Math.max(minC, Math.min(maxC, Math.round(targetCenter)));
    let bestScore = -1e12;

    for (let cand = minC; cand <= maxC; cand += 12) {
      const s = this.scoreCand(cand, oldPos, pitchStep, 12);
      if (s > bestScore) {
        bestScore = s;
        bestPos = cand;
      }
    }

    const fMin = Math.max(minC, bestPos - 11);
    const fMax = Math.min(maxC, bestPos + 11);
    for (let cand = fMin; cand <= fMax; cand++) {
      const s = this.scoreCand(cand, oldPos, pitchStep, 6);
      if (s > bestScore) {
        bestScore = s;
        bestPos = cand;
      }
    }
    return bestPos;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const out0 = output[0];
    const out1 = output.length > 1 ? output[1] : null;
    const blockLen = out0.length;

    if (!this.isPlaying || !this.ch0 || this.srcLen <= 1) {
      for (let i = 0; i < blockLen; i++) {
        out0[i] = 0;
        if (out1) out1[i] = 0;
      }
      return true;
    }

    let srRatio = this.srcRate / sampleRate;
    let isSlewing =
      Math.abs(this.targetSpeed - this.speed) > 1e-5 ||
      Math.abs(this.targetSemitones - this.semitones) > 1e-5;
    let tempoStep = this.speed * srRatio;
    let pitchRatio = Math.pow(2, this.semitones / 12);
    let pitchStep = pitchRatio * srRatio;
    let isNaturalRatio =
      Math.abs(this.speed - 1) < 0.0002 &&
      Math.abs(this.targetSpeed - 1) < 0.0002 &&
      Math.abs(this.semitones) < 0.001 &&
      Math.abs(this.targetSemitones) < 0.001;
    let isExactSr = Math.abs(srRatio - 1) < 0.0002;
    let isExactPitch = Math.abs(pitchStep - 1) < 0.0002;

    let c0 = this.ch0;
    let c1 = this.ch1;
    let len = this.srcLen;

    for (let i = 0; i < blockLen; i++) {
      if (isSlewing) {
        this.speed += (this.targetSpeed - this.speed) * 0.0018;
        this.semitones += (this.targetSemitones - this.semitones) * 0.0018;
        if (Math.abs(this.targetSpeed - this.speed) <= 1e-5) this.speed = this.targetSpeed;
        if (Math.abs(this.targetSemitones - this.semitones) <= 1e-5) this.semitones = this.targetSemitones;
        tempoStep = this.speed * srRatio;
        pitchRatio = Math.pow(2, this.semitones / 12);
        pitchStep = pitchRatio * srRatio;
        isExactPitch = Math.abs(pitchStep - 1) < 0.0002;
        isNaturalRatio =
          Math.abs(this.speed - 1) < 0.0002 &&
          Math.abs(this.targetSpeed - 1) < 0.0002 &&
          Math.abs(this.semitones) < 0.001 &&
          Math.abs(this.targetSemitones) < 0.001;
        isSlewing =
          this.speed !== this.targetSpeed || this.semitones !== this.targetSemitones;
      }

      if (this.loopEnabled && this.loopBSample > this.loopASample + 100 && this.playPos >= this.loopBSample) {
        this.oldReadPos = this.readPos;
        this.playPos = this.loopASample;
        this.readPos = this.loopASample;
        this.xfadeTotal = 384;
        this.xfadePos = 0;
        this.xfadePitchStep = pitchStep;
        this.spliceCounter = 0;
        this.port.postMessage({ type: 'looped' });
      } else if (this.playPos >= len - 1) {
        if (this.autoAdvance && this.nextId && this.nextCh0 && this.nextLen > 1 && !this.pauseAfterFade) {
          const promotedId = this.nextId;
          this.activeId = promotedId;
          this.ch0 = this.nextCh0;
          this.ch1 = this.nextCh1 || this.nextCh0;
          this.srcLen = this.nextLen;
          this.srcRate = this.nextRate || sampleRate;
          this.targetSpeed = this.nextSpeed;
          this.speed = this.nextSpeed;
          this.targetSemitones = this.nextSemitones;
          this.semitones = this.nextSemitones;

          this.nextId = '';
          this.nextCh0 = null;
          this.nextCh1 = null;
          this.nextLen = 0;

          this.playPos = 0;
          this.readPos = 0;
          this.oldReadPos = 0;
          this.xfadePos = -1;
          this.spliceCounter = 0;
          this.bypassFade = 0;
          this.seekXfade = 0;
          this.fadeInTotal = 96;
          this.fadeInSamples = 96;
          this.endedSent = false;
          this.loopEnabled = false;
          this.wasBypassed = Math.abs(this.speed - 1) < 0.0002 && Math.abs(this.semitones) < 0.001;

          c0 = this.ch0;
          c1 = this.ch1;
          len = this.srcLen;
          srRatio = this.srcRate / sampleRate;
          tempoStep = this.speed * srRatio;
          pitchRatio = Math.pow(2, this.semitones / 12);
          pitchStep = pitchRatio * srRatio;
          isNaturalRatio = Math.abs(this.speed - 1) < 0.0002 && Math.abs(this.semitones) < 0.001;
          isExactSr = Math.abs(srRatio - 1) < 0.0002;
          isExactPitch = Math.abs(pitchStep - 1) < 0.0002;
          isSlewing = false;

          this.port.postMessage({ type: 'autoAdvanced', nextId: promotedId });
        } else {
          this.isPlaying = false;
          this.pauseAfterFade = false;
          this.pauseFade = 0;
          this.playPos = 0;
          this.readPos = 0;
          for (let j = i; j < blockLen; j++) {
            out0[j] = 0;
            if (out1) out1[j] = 0;
          }
          if (!this.endedSent) {
            this.endedSent = true;
            this.port.postMessage({ type: 'ended' });
          }
          return true;
        }
      }

      let s0 = 0;
      let s1 = 0;

      if (isNaturalRatio) {
        if (!this.wasBypassed) {
          this.oldReadPos = this.readPos;
          this.readPos = this.playPos;
          this.bypassFadeTotal = 384;
          this.bypassFade = 384;
          this.bypassOldStep = this.lastPitchStep || srRatio;
          this.wasBypassed = true;
          this.xfadePos = -1;
        }
        let dry0;
        let dry1;
        if (isExactSr && Math.abs(this.playPos - Math.round(this.playPos)) < 1e-4) {
          const idx = Math.min(len - 1, Math.max(0, Math.round(this.playPos)));
          dry0 = c0[idx];
          dry1 = c1[idx];
        } else {
          dry0 = this.cubicRead(c0, this.playPos);
          dry1 = this.cubicRead(c1, this.playPos);
        }

        if (this.bypassFade > 0) {
          const wet0 = this.cubicRead(c0, this.oldReadPos);
          const wet1 = this.cubicRead(c1, this.oldReadPos);
          const wOut = 0.5 * (1 - Math.cos(Math.PI * (this.bypassFade / this.bypassFadeTotal)));
          s0 = wet0 * wOut + dry0 * (1 - wOut);
          s1 = wet1 * wOut + dry1 * (1 - wOut);
          this.oldReadPos += this.bypassOldStep;
          this.bypassFade--;
        } else {
          s0 = dry0;
          s1 = dry1;
        }
        this.playPos += srRatio;
        this.readPos = this.playPos;
        this.lastPitchStep = srRatio;
      } else {
        if (this.wasBypassed) {
          this.readPos = this.playPos;
          this.wasBypassed = false;
          this.bypassFade = 0;
          this.spliceCounter = 0;
        }

        // Trigger phase-locked WSOLA splice when read cursor drifts from timeline
        if (this.xfadePos < 0 && this.spliceCounter >= this.splicePeriod) {
          this.spliceCounter = 0;
          if (Math.abs(this.readPos - this.playPos) >= 48) {
            this.oldReadPos = this.readPos;
            this.xfadePitchStep = pitchStep;
            this.readPos = this.findBestAnchor(this.playPos, this.oldReadPos, pitchStep);
            this.xfadeTotal = this.overlapLen;
            this.xfadePos = 0;
          }
        }

        if (isExactPitch && Math.abs(this.readPos - Math.round(this.readPos)) < 1e-4) {
          const idx = Math.min(len - 1, Math.max(0, Math.round(this.readPos)));
          s0 = c0[idx];
          s1 = c1[idx];
        } else {
          s0 = this.cubicRead(c0, this.readPos);
          s1 = this.cubicRead(c1, this.readPos);
        }

        if (this.xfadePos >= 0) {
          const old0 =
            isExactPitch && Math.abs(this.oldReadPos - Math.round(this.oldReadPos)) < 1e-4
              ? c0[Math.min(len - 1, Math.max(0, Math.round(this.oldReadPos)))]
              : this.cubicRead(c0, this.oldReadPos);
          const old1 =
            isExactPitch && Math.abs(this.oldReadPos - Math.round(this.oldReadPos)) < 1e-4
              ? c1[Math.min(len - 1, Math.max(0, Math.round(this.oldReadPos)))]
              : this.cubicRead(c1, this.oldReadPos);

          const phase = this.xfadePos / this.xfadeTotal;
          const wIn = 0.5 * (1 - Math.cos(Math.PI * phase));
          const wOut = 1 - wIn;

          s0 = old0 * wOut + s0 * wIn;
          s1 = old1 * wOut + s1 * wIn;

          this.oldReadPos += this.xfadePitchStep;
          this.xfadePos++;
          if (this.xfadePos >= this.xfadeTotal) {
            this.xfadePos = -1;
          }
        }

        this.readPos += pitchStep;
        this.playPos += tempoStep;
        this.spliceCounter++;
        this.lastPitchStep = pitchStep;
      }

      // Smooth cosine crossfade after seeking while playing
      if (this.seekXfade > 0) {
        const old0 = this.cubicRead(c0, this.seekOldPos);
        const old1 = this.cubicRead(c1, this.seekOldPos);
        const wOut = 0.5 * (1 - Math.cos(Math.PI * (this.seekXfade / this.seekXfadeTotal)));
        s0 = old0 * wOut + s0 * (1 - wOut);
        s1 = old1 * wOut + s1 * (1 - wOut);
        this.seekOldPos += this.seekOldStep;
        this.seekXfade--;
      }

      // Smooth tail taper when stopping naturally (not auto-advancing)
      if (!this.loopEnabled && (!this.autoAdvance || !this.nextCh0 || this.nextLen <= 1)) {
        const rem = (len - 1) - this.playPos;
        if (rem >= 0 && rem < 256) {
          const tailGain = rem / 256;
          s0 *= tailGain;
          s1 *= tailGain;
        }
      }

      if (this.fadeInSamples > 0) {
        const p = (this.fadeInTotal - this.fadeInSamples) / this.fadeInTotal;
        const gain = 0.5 * (1 - Math.cos(Math.PI * p));
        s0 *= gain;
        s1 *= gain;
        this.fadeInSamples--;
      }

      if (this.pauseAfterFade) {
        const p = Math.max(0, this.pauseFade / this.pauseFadeTotal);
        const pGain = 0.5 * (1 - Math.cos(Math.PI * p));
        s0 *= pGain;
        s1 *= pGain;
        if (!Number.isFinite(s0)) s0 = 0;
        if (!Number.isFinite(s1)) s1 = 0;
        out0[i] = Math.max(-0.999, Math.min(0.999, s0));
        if (out1) out1[i] = Math.max(-0.999, Math.min(0.999, s1));
        this.pauseFade--;
        if (this.pauseFade <= 0) {
          this.pauseAfterFade = false;
          this.isPlaying = false;
          if (this.pendingSeekAfterPause >= 0) {
            this.playPos = this.pendingSeekAfterPause;
            this.readPos = this.pendingSeekAfterPause;
            this.oldReadPos = this.pendingSeekAfterPause;
            this.xfadePos = -1;
            this.spliceCounter = 0;
            this.pendingSeekAfterPause = -1;
          }
          for (let j = i + 1; j < blockLen; j++) {
            out0[j] = 0;
            if (out1) out1[j] = 0;
          }
          return true;
        }
        continue;
      }

      // Transparent C1 soft-ceiling limiter (> 0.985) + NaN guard so DAC never clips
      if (!Number.isFinite(s0)) s0 = 0;
      if (!Number.isFinite(s1)) s1 = 0;
      if (s0 > 0.985) s0 = 0.985 + Math.tanh((s0 - 0.985) / 0.014) * 0.014;
      else if (s0 < -0.985) s0 = -0.985 + Math.tanh((s0 + 0.985) / 0.014) * 0.014;
      if (s1 > 0.985) s1 = 0.985 + Math.tanh((s1 - 0.985) / 0.014) * 0.014;
      else if (s1 < -0.985) s1 = -0.985 + Math.tanh((s1 + 0.985) / 0.014) * 0.014;

      out0[i] = s0;
      if (out1) out1[i] = s1;
    }

    this.posReportCounter++;
    if (this.posReportCounter >= 18) {
      this.posReportCounter = 0;
      this.port.postMessage({ type: 'pos', sample: this.playPos });
    }

    return true;
  }
}

registerProcessor('${PITCH_WORKLET_NAME}', RiveraPitchShifterProcessor);
`;

export function createPitchWorkletBlobUrl(): string {
  const blob = new Blob([PITCH_WORKLET_CODE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

/**
 * Extract normalized min/max waveform peaks for high-DPI canvas rendering.
 */
export function extractWaveformPeaks(buffer: AudioBuffer, bucketCount = 640): Float32Array {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const totalSamples = left.length;
  const peaks = new Float32Array(bucketCount);
  const step = Math.max(1, Math.floor(totalSamples / bucketCount));

  let maxPeak = 0.001;
  for (let i = 0; i < bucketCount; i++) {
    const start = Math.floor((i * totalSamples) / bucketCount);
    const end = Math.min(totalSamples, start + step);
    let peak = 0;
    const stride = Math.max(1, Math.floor((end - start) / 16));
    for (let j = start; j < end; j += stride) {
      const val = Math.max(Math.abs(left[j]), Math.abs(right[j]));
      if (val > peak) peak = val;
    }
    peaks[i] = peak;
    if (peak > maxPeak) maxPeak = peak;
  }

  for (let i = 0; i < bucketCount; i++) {
    peaks[i] = Math.min(1, peaks[i] / maxPeak);
  }
  return peaks;
}

/**
 * Fast onset-autocorrelation BPM & downbeat offset detector.
 */
export function detectBpmAndOffset(buffer: AudioBuffer): { bpm: number; beatOffset: number } {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const envRate = 200; // 5ms resolution
  const hop = Math.max(1, Math.floor(sr / envRate));
  const maxSamples = Math.min(data.length, sr * 75); // analyze up to first 75s
  const numFrames = Math.floor(maxSamples / hop);

  if (numFrames < envRate * 4) {
    return { bpm: 120, beatOffset: 0 };
  }

  const energy = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const start = i * hop;
    let sum = 0;
    for (let j = 0; j < hop; j++) {
      const s = data[start + j];
      sum += s * s;
    }
    energy[i] = Math.sqrt(sum / hop);
  }

  const onset = new Float32Array(numFrames);
  for (let i = 1; i < numFrames; i++) {
    const diff = energy[i] - energy[i - 1];
    onset[i] = diff > 0 ? diff : 0;
  }

  const minBpm = 65;
  const maxBpm = 175;
  let bestBpm = 110;
  let bestScore = -1;

  for (let bpm = minBpm; bpm <= maxBpm; bpm++) {
    const lag = Math.round((60 / bpm) * envRate);
    let score = 0;
    const limit = numFrames - lag * 2;
    for (let i = 0; i < limit; i++) {
      score += onset[i] * (onset[i + lag] + 0.5 * onset[i + lag * 2]);
    }
    // Slight preference for typical musical tempo band 85-145 BPM to avoid octave errors
    const tempoPrior = bpm >= 85 && bpm <= 145 ? 1.12 : 1.0;
    const weighted = (score / Math.max(1, limit)) * tempoPrior;
    if (weighted > bestScore) {
      bestScore = weighted;
      bestBpm = bpm;
    }
  }

  // Find best phase offset within one beat period
  const beatPeriodSec = 60 / bestBpm;
  const beatFrames = beatPeriodSec * envRate;
  let bestOffsetFrames = 0;
  let bestPhaseScore = -1;
  const steps = Math.max(10, Math.round(beatFrames));

  for (let p = 0; p < steps; p++) {
    let phaseScore = 0;
    for (let k = p; k < numFrames; k += beatFrames) {
      const idx = Math.round(k);
      if (idx < numFrames) {
        phaseScore += onset[idx];
      }
    }
    if (phaseScore > bestPhaseScore) {
      bestPhaseScore = phaseScore;
      bestOffsetFrames = p;
    }
  }

  return {
    bpm: bestBpm,
    beatOffset: Number((bestOffsetFrames / envRate).toFixed(3)),
  };
}

function writeWavHeader(
  view: DataView,
  numChannels: number,
  sampleRate: number,
  dataSize: number
): void {
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  const blockAlign = numChannels * 2;
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
}

function softLimitSample(s: number): number {
  if (!Number.isFinite(s)) return 0;
  if (s > 0.985) return 0.985 + Math.tanh((s - 0.985) / 0.014) * 0.014;
  if (s < -0.985) return -0.985 + Math.tanh((s + 0.985) / 0.014) * 0.014;
  return s;
}

function cubicReadAt(buf: Float32Array, srcLen: number, pos: number): number {
  if (srcLen <= 0) return 0;
  if (pos <= 0) return buf[0];
  if (pos >= srcLen - 1) return buf[srcLen - 1];
  const i1 = Math.floor(pos);
  const t = pos - i1;
  if (t < 1e-5) return buf[i1];
  const i0 = i1 > 0 ? i1 - 1 : 0;
  const i2 = i1 + 1 < srcLen ? i1 + 1 : srcLen - 1;
  const i3 = i1 + 2 < srcLen ? i1 + 2 : srcLen - 1;
  const y0 = buf[i0];
  const y1 = buf[i1];
  const y2 = buf[i2];
  const y3 = buf[i3];
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

function scoreWsolaCandidate(
  ch0: Float32Array,
  ch1: Float32Array,
  srcLen: number,
  candCenter: number,
  oldPos: number,
  pitchStep: number,
  corrLen: number,
  stride: number
): number {
  let dot = 0;
  let normA = 1e-9;
  let normB = 1e-9;
  for (let k = 0; k < corrLen; k += stride) {
    const idxA = Math.floor(oldPos + k * pitchStep);
    const idxB = Math.floor(candCenter + k * pitchStep);
    if (idxA < 0 || idxA >= srcLen || idxB < 0 || idxB >= srcLen) break;
    const a0 = ch0[idxA];
    const a1 = ch1[idxA];
    const b0 = ch0[idxB];
    const b1 = ch1[idxB];
    dot += a0 * b0 + a1 * b1;
    normA += a0 * a0 + a1 * a1;
    normB += b0 * b0 + b1 * b1;
  }
  if (normA < 1e-6 && normB < 1e-6) return 0.99;
  if (normA < 1e-7 || normB < 1e-7) return -1;
  return dot / Math.sqrt(normA * normB);
}

function findBestWsolaAnchor(
  ch0: Float32Array,
  ch1: Float32Array,
  srcLen: number,
  targetCenter: number,
  oldPos: number,
  pitchStep: number,
  overlapLen: number,
  seekHalf: number,
  corrLen: number
): number {
  const maxSafe = Math.max(0, srcLen - Math.ceil(overlapLen * pitchStep) - 4);
  const minC = Math.max(0, Math.floor(targetCenter - seekHalf));
  const maxC = Math.min(maxSafe, Math.floor(targetCenter + seekHalf));
  if (maxC <= minC) return Math.max(0, Math.min(maxSafe, targetCenter));

  let bestPos = Math.max(minC, Math.min(maxC, Math.round(targetCenter)));
  let bestScore = -1e12;

  for (let cand = minC; cand <= maxC; cand += 12) {
    const s = scoreWsolaCandidate(ch0, ch1, srcLen, cand, oldPos, pitchStep, corrLen, 12);
    if (s > bestScore) {
      bestScore = s;
      bestPos = cand;
    }
  }

  const fMin = Math.max(minC, bestPos - 11);
  const fMax = Math.min(maxC, bestPos + 11);
  for (let cand = fMin; cand <= fMax; cand++) {
    const s = scoreWsolaCandidate(ch0, ch1, srcLen, cand, oldPos, pitchStep, corrLen, 6);
    if (s > bestScore) {
      bestScore = s;
      bestPos = cand;
    }
  }
  return bestPos;
}

/**
 * Encode an AudioBuffer into a 16-bit PCM WAV Blob.
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const dataSize = numFrames * numChannels * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  writeWavHeader(view, numChannels, sampleRate, dataSize);

  const ch0 = buffer.getChannelData(0);
  const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const s0 = Math.max(-1, Math.min(1, ch0[i]));
    view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true);
    offset += 2;
    if (numChannels > 1) {
      const s1 = Math.max(-1, Math.min(1, ch1[i]));
      view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export interface ExportTrackAudioOptions {
  source: AudioBuffer;
  speed: number;
  totalSemitones: number;
  volumeL: number;
  volumeR: number;
  swapLR: boolean;
  onProgress?: (progress: number) => void;
}

/**
 * Offline phase-locked WSOLA + Catmull-Rom cubic interpolation WAV exporter.
 * Matches the real-time worklet sound and bakes in Pitch, BPM/Speed, Volume L/R, and L/R swap.
 */
export async function exportTrackAudioToWav({
  source,
  speed,
  totalSemitones,
  volumeL,
  volumeR,
  swapLR,
  onProgress,
}: ExportTrackAudioOptions): Promise<Blob> {
  const sr = source.sampleRate;
  const srcLen = source.length;
  const ch0 = source.getChannelData(0);
  const ch1 = source.numberOfChannels > 1 ? source.getChannelData(1) : ch0;

  const clampedSpeed = Math.max(0.25, Math.min(2.5, speed || 1));
  const clampedSemi = Math.max(-12, Math.min(12, totalSemitones || 0));
  const pitchRatio = Math.pow(2, clampedSemi / 12);

  const volL = Math.max(0, Math.min(1.5, volumeL ?? 1));
  const volR = Math.max(0, Math.min(1.5, volumeR ?? 1));

  const isExactPitch = Math.abs(pitchRatio - 1) < 0.0002;
  const isBypass = isExactPitch && Math.abs(clampedSpeed - 1) < 0.0002;

  const maxFrames = isBypass ? srcLen : Math.ceil(srcLen / clampedSpeed) + 512;
  const numChannels = 2;
  const blockAlign = numChannels * 2;
  const arrayBuffer = new ArrayBuffer(44 + maxFrames * blockAlign);
  const view = new DataView(arrayBuffer);

  writeWavHeader(view, numChannels, sr, maxFrames * blockAlign);

  const yieldToMain = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

  let writtenFrames = 0;
  let byteOffset = 44;

  const writeStereoFrame = (raw0: number, raw1: number) => {
    const scaledL = raw0 * volL;
    const scaledR = raw1 * volR;
    const final0 = Math.max(-1, Math.min(1, softLimitSample(swapLR ? scaledR : scaledL)));
    const final1 = Math.max(-1, Math.min(1, softLimitSample(swapLR ? scaledL : scaledR)));
    view.setInt16(byteOffset, final0 < 0 ? final0 * 0x8000 : final0 * 0x7fff, true);
    view.setInt16(byteOffset + 2, final1 < 0 ? final1 * 0x8000 : final1 * 0x7fff, true);
    byteOffset += 4;
    writtenFrames++;
  };

  if (isBypass) {
    const chunk = 131072;
    for (let i = 0; i < srcLen; i++) {
      writeStereoFrame(ch0[i], ch1[i]);
      if (i > 0 && i % chunk === 0) {
        onProgress?.(Math.min(0.99, i / srcLen));
        await yieldToMain();
      }
    }
  } else {
    const overlapLen = 1024;
    const splicePeriod = 2560;
    const seekHalf = 768;
    const corrLen = 1024;

    let playPos = 0;
    let readPos = 0;
    let oldReadPos = 0;
    let spliceCounter = 0;
    let xfadePos = -1;
    const xfadeTotal = overlapLen;
    let xfadePitchStep = pitchRatio;
    const chunk = 65536;

    while (playPos < srcLen - 1 && writtenFrames < maxFrames) {
      if (xfadePos < 0 && spliceCounter >= splicePeriod) {
        spliceCounter = 0;
        if (Math.abs(readPos - playPos) >= 48) {
          oldReadPos = readPos;
          xfadePitchStep = pitchRatio;
          readPos = findBestWsolaAnchor(
            ch0,
            ch1,
            srcLen,
            playPos,
            oldReadPos,
            pitchRatio,
            overlapLen,
            seekHalf,
            corrLen
          );
          xfadePos = 0;
        }
      }

      let s0: number;
      let s1: number;
      if (isExactPitch && Math.abs(readPos - Math.round(readPos)) < 1e-4) {
        const idx = Math.min(srcLen - 1, Math.max(0, Math.round(readPos)));
        s0 = ch0[idx];
        s1 = ch1[idx];
      } else {
        s0 = cubicReadAt(ch0, srcLen, readPos);
        s1 = cubicReadAt(ch1, srcLen, readPos);
      }

      if (xfadePos >= 0) {
        const old0 =
          isExactPitch && Math.abs(oldReadPos - Math.round(oldReadPos)) < 1e-4
            ? ch0[Math.min(srcLen - 1, Math.max(0, Math.round(oldReadPos)))]
            : cubicReadAt(ch0, srcLen, oldReadPos);
        const old1 =
          isExactPitch && Math.abs(oldReadPos - Math.round(oldReadPos)) < 1e-4
            ? ch1[Math.min(srcLen - 1, Math.max(0, Math.round(oldReadPos)))]
            : cubicReadAt(ch1, srcLen, oldReadPos);

        const phase = xfadePos / xfadeTotal;
        const wIn = 0.5 * (1 - Math.cos(Math.PI * phase));
        const wOut = 1 - wIn;

        s0 = old0 * wOut + s0 * wIn;
        s1 = old1 * wOut + s1 * wIn;

        oldReadPos += xfadePitchStep;
        xfadePos++;
        if (xfadePos >= xfadeTotal) {
          xfadePos = -1;
        }
      }

      writeStereoFrame(s0, s1);
      readPos += pitchRatio;
      playPos += clampedSpeed;
      spliceCounter++;

      if (writtenFrames % chunk === 0) {
        onProgress?.(Math.min(0.99, playPos / srcLen));
        await yieldToMain();
      }
    }
  }

  const finalDataSize = writtenFrames * blockAlign;
  view.setUint32(4, 36 + finalDataSize, true);
  view.setUint32(40, finalDataSize, true);
  onProgress?.(1);

  return new Blob([new Uint8Array(arrayBuffer, 0, 44 + finalDataSize)], { type: 'audio/wav' });
}

export function formatTimecode(seconds: number, showMillis = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (!showMillis) {
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  const tenths = Math.floor((seconds % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}
