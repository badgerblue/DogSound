(() => {
  const DISPLAY_CEILING = 0.2;
  const MIN_THRESHOLD = 0.006;
  const MAX_THRESHOLD = 0.12;
  const BARK_COOLDOWN_MS = 1600;
  const QUIET_SLEEP_MS = 2600;
  const WAKE_LEAD_MS = 180;

  const scene = document.getElementById("scene");
  const statusText = document.getElementById("statusText");
  const micBtn = document.getElementById("micBtn");
  const muteBtn = document.getElementById("muteBtn");
  const testBtn = document.getElementById("testBtn");
  const sensitivity = document.getElementById("sensitivity");
  const sensitivityValue = document.getElementById("sensitivityValue");
  const meter = document.getElementById("meter");
  const meterFill = document.getElementById("meterFill");
  const meterThreshold = document.getElementById("meterThreshold");
  const levelReadout = document.getElementById("levelReadout");
  const thresholdReadout = document.getElementById("thresholdReadout");
  const errorText = document.getElementById("errorText");

  let audioContext = null;
  let analyser = null;
  let micSource = null;
  let mediaStream = null;
  let timeDomain = null;
  let rafId = 0;
  let monitoring = false;
  let muted = false;
  let smoothedLevel = 0;
  let lastBarkAt = 0;
  let lastLoudAt = 0;
  let wakeTimer = 0;
  let dogState = "sleeping";

  function thresholdFromSensitivity(value) {
    const t = Number(value);
    return MIN_THRESHOLD + (t / 100) * (MAX_THRESHOLD - MIN_THRESHOLD);
  }

  function levelToPercent(level) {
    return Math.max(0, Math.min(100, (level / DISPLAY_CEILING) * 100));
  }

  function formatLevel(level) {
    return `${Math.round(levelToPercent(level))}%`;
  }

  function setError(message) {
    if (!message) {
      errorText.hidden = true;
      errorText.textContent = "";
      return;
    }
    errorText.hidden = false;
    errorText.textContent = message;
  }

  function setState(next, message) {
    dogState = next;
    scene.dataset.state = next;
    if (message) statusText.textContent = message;
  }

  function updateThresholdUi() {
    const threshold = thresholdFromSensitivity(sensitivity.value);
    sensitivityValue.textContent = sensitivity.value;
    thresholdReadout.textContent = formatLevel(threshold);
    meterThreshold.style.left = `${levelToPercent(threshold)}%`;
  }

  function updateMeter(level) {
    const percent = levelToPercent(level);
    meterFill.style.width = `${percent}%`;
    meter.setAttribute("aria-valuenow", String(Math.round(percent)));
    levelReadout.textContent = formatLevel(level);
  }

  function ensureAudioContext() {
    if (!audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioContext = new Ctx();
    }
    return audioContext.resume();
  }

  function playBark() {
    if (muted) return;
    const ctx = audioContext;
    if (!ctx) return;

    const now = ctx.currentTime;

    const makeWoof = (start, freq, duration, gainValue) => {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.42), start + duration);
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(900, start);
      filter.Q.value = 1.1;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    };

    const noiseDuration = 0.16;
    const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseDuration), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    noise.buffer = noiseBuffer;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1400;
    noiseGain.gain.setValueAtTime(0.12, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDuration);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);

    makeWoof(now, 430, 0.12, 0.28);
    makeWoof(now + 0.12, 260, 0.18, 0.24);
  }

  function triggerBark(fromTest) {
    const now = performance.now();
    if (!fromTest && now - lastBarkAt < BARK_COOLDOWN_MS) return;

    lastBarkAt = now;
    lastLoudAt = now;
    window.clearTimeout(wakeTimer);

    setState("waking", fromTest ? "Testing a bark!" : "What was that?!");
    wakeTimer = window.setTimeout(() => {
      setState("barking", fromTest ? "Woof! (test bark)" : "Woof! Something noisy happened.");
      playBark();
    }, WAKE_LEAD_MS);
  }

  function rmsFromAnalyser() {
    analyser.getFloatTimeDomainData(timeDomain);
    let sum = 0;
    for (let i = 0; i < timeDomain.length; i += 1) {
      const sample = timeDomain[i];
      sum += sample * sample;
    }
    return Math.sqrt(sum / timeDomain.length);
  }

  function loop() {
    if (!monitoring || !analyser) return;

    const rms = rmsFromAnalyser();
    const attack = rms > smoothedLevel ? 0.55 : 0.16;
    smoothedLevel = smoothedLevel * (1 - attack) + rms * attack;
    updateMeter(smoothedLevel);

    const threshold = thresholdFromSensitivity(sensitivity.value);
    const now = performance.now();

    if (smoothedLevel >= threshold) {
      lastLoudAt = now;
      if (dogState === "sleeping") {
        triggerBark(false);
      }
    } else if (dogState !== "sleeping" && now - lastLoudAt > QUIET_SLEEP_MS) {
      setState("sleeping", "Back to sleep. Keep it cozy and quiet.");
    }

    rafId = window.requestAnimationFrame(loop);
  }

  async function startMonitoring() {
    setError("");
    await ensureAudioContext();

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
      },
      video: false,
    });

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.35;
    timeDomain = new Float32Array(analyser.fftSize);
    micSource = audioContext.createMediaStreamSource(mediaStream);
    micSource.connect(analyser);

    monitoring = true;
    micBtn.textContent = "Disable Microphone";
    setState("sleeping", "Listening… the pup is napping until it gets noisy.");
    loop();
  }

  function stopMonitoring() {
    monitoring = false;
    window.cancelAnimationFrame(rafId);
    rafId = 0;

    if (micSource) {
      micSource.disconnect();
      micSource = null;
    }
    if (analyser) {
      analyser.disconnect();
      analyser = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }

    smoothedLevel = 0;
    updateMeter(0);
    micBtn.textContent = "Enable Microphone";
    setState("sleeping", "Microphone off. The pup can still nap — try Test Bark anytime.");
  }

  async function toggleMic() {
    if (monitoring) {
      stopMonitoring();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("This browser cannot access the microphone.");
      return;
    }

    micBtn.disabled = true;
    try {
      await startMonitoring();
    } catch (err) {
      const name = err && err.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("Microphone permission was denied. Allow access in the browser, then try again.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setError("No microphone was found. Plug one in and try again.");
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        setError("The microphone is already in use or could not be opened.");
      } else if (window.isSecureContext === false) {
        setError("Microphone access needs a local server (http://localhost), not a raw file:// page.");
      } else {
        setError("Could not start the microphone. Check permissions and try again.");
      }
      stopMonitoring();
    } finally {
      micBtn.disabled = false;
    }
  }

  micBtn.addEventListener("click", () => {
    toggleMic();
  });

  muteBtn.addEventListener("click", () => {
    muted = !muted;
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.textContent = muted ? "Unmute Bark" : "Mute Bark";
  });

  testBtn.addEventListener("click", async () => {
    await ensureAudioContext();
    triggerBark(true);
    window.setTimeout(() => {
      if (!monitoring) {
        setState("sleeping", "Back to dreaming. Enable the microphone to listen for real sounds.");
      }
    }, QUIET_SLEEP_MS);
  });

  sensitivity.addEventListener("input", updateThresholdUi);

  window.addEventListener("beforeunload", () => {
    stopMonitoring();
  });

  updateThresholdUi();
  updateMeter(0);
  setState("sleeping", "Dreaming on a cozy bed. Tap Enable Microphone to start listening.");
})();
