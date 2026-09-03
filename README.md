# Browser Voice Interview

Static browser demo for a voice interview flow.

## What It Does

- Speaks a fixed three-question interview.
- Uses Silero VAD in the browser to detect when the user stops speaking.
- Moves to the next question immediately after VAD detects the end of speech.
- Runs Whisper STT in the background and shows the transcript when ready.
- Uses Browser SpeechSynthesis by default for low-latency TTS.
- Keeps Kokoro ONNX available as an optional TTS engine.
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
