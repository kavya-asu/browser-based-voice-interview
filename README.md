# Oral Assessment POC

Static browser demo for a voice interview flow.

## What It Does

- Uses a two-step mobile-friendly flow: prepare the microphone first, then start the spoken interview from a fresh tap.
- Speaks a fixed three-question interview.
- Uses Silero VAD in the browser to detect when the user stops speaking.
- Moves to the next question immediately after VAD detects the end of speech.
- Runs Whisper STT in the background and shows the transcript when ready.
- Uses Browser SpeechSynthesis by default for low-latency TTS.
- Keeps Kokoro ONNX available as an optional TTS engine.
- Uses safe defaults: whisper-tiny, WASM CPU, Browser SpeechSynthesis, and an en-US browser voice.
- Shows an inline warning when heavier STT models, WebGPU, Auto runtime, Kokoro, or Safari are used.
- Includes a restart button that reloads the page and releases the active browser session memory.
- On iPhone/Safari, the first tap is intentionally used for microphone permission and VAD setup. The second tap starts speech so browser audio is less likely to be blocked.
- Does not upload or persist user recordings; audio is held in memory only long enough for browser transcription.

## Files

- `index.html` - page structure and model/settings controls.
- `transformers-lab.js` - VAD, STT, TTS, interview flow, timing logs.
- `transformers-lab.css` - minimal microphone UI, transcript area, waveform, settings.
- `package.json` - small Vercel/static project metadata.

## Local Run

```bash
cd demo
python3 -m http.server 7861
```

Open:

```text
http://localhost:7861/
```

## Vercel

This is a static frontend app. No Python server or backend is required for the current demo.

The browser downloads model assets from CDN/Hugging Face on first use, then uses browser cache.
