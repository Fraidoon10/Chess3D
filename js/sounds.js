/* Web Audio API sound effects */
const Sounds = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function playTone(freq, type, duration, gain = 0.18, decay = 0.8) {
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const vol = c.createGain();
      osc.connect(vol);
      vol.connect(c.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      vol.gain.setValueAtTime(gain, c.currentTime);
      vol.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
      osc.start(c.currentTime);
      osc.stop(c.currentTime + duration);
    } catch (e) { /* ignore */ }
  }

  function playNoise(duration, gain = 0.06) {
    try {
      const c = getCtx();
      const bufSize = c.sampleRate * duration;
      const buf = c.createBuffer(1, bufSize, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      const vol = c.createGain();
      src.connect(vol);
      vol.connect(c.destination);
      vol.gain.setValueAtTime(gain, c.currentTime);
      vol.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
      src.start(c.currentTime);
    } catch (e) { /* ignore */ }
  }

  return {
    move() {
      playTone(440, 'triangle', 0.12, 0.15);
      playNoise(0.05, 0.04);
    },
    capture() {
      playTone(220, 'sawtooth', 0.18, 0.2);
      playNoise(0.12, 0.08);
    },
    check() {
      playTone(880, 'sine', 0.12, 0.25);
      setTimeout(() => playTone(660, 'sine', 0.12, 0.2), 120);
    },
    checkmate() {
      playTone(330, 'sawtooth', 0.3, 0.25);
      setTimeout(() => playTone(220, 'sawtooth', 0.5, 0.3), 200);
    },
    castle() {
      playTone(523, 'triangle', 0.1, 0.2);
      setTimeout(() => playTone(659, 'triangle', 0.15, 0.18), 80);
    },
    promote() {
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => playTone(f, 'sine', 0.18, 0.25), i * 80);
      });
    },
    select() {
      playTone(600, 'sine', 0.07, 0.1);
    },
    error() {
      playTone(180, 'sawtooth', 0.15, 0.1);
    }
  };
})();
