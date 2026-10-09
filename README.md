# Sleepy Pup

A tiny static site: a cartoon dog sleeps on a cozy bed and wakes up to bark when the microphone hears a sound above a sensitivity threshold.

Everything runs in the browser with HTML, CSS, and vanilla JavaScript. There is no backend and there are no required dependencies.

## Run locally

Microphone access needs a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). Opening `index.html` as a `file://` page often fails, so serve the folder over `http://localhost`.

From this directory:

```bash
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

If you use Node.js:

```bash
npx --yes serve .
```

## How to use it

1. The dog starts asleep. You can press **Test Bark** before enabling the mic.
2. Click **Enable Microphone** and allow permission.
3. Move **Sensitivity** (0–100, default 60). Lower values make the dog wake more easily.
4. Watch the live audio-level meter. The dark marker is the wake threshold.
5. Make a noise. After a bark, the dog goes back to sleep once things stay quiet for a couple of seconds.
6. **Mute Bark** silences the bark sound but still animates the dog.
7. **Disable Microphone** stops listening and ends the microphone tracks.

The meter shows relative amplitude from the Web Audio API (`AnalyserNode` + RMS), not calibrated decibels.
