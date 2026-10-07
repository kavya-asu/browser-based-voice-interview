# Oral Assessment POC

Browser voice interview with optional assignment-based question generation.

## What It Does

- Uses a two-step mobile-friendly flow: prepare the microphone first, then start the spoken interview from a fresh tap.
- Accepts PDF, DOCX, and TXT assignments up to 3 MB.
- Uses a server-side LiteLLM request to pre-generate three assignment-specific questions.
- Supports a local MiniCPM model (via Ollama) as an alternative question-generation method so you can compare cloud vs. local inference time side-by-side.
- Keeps default questions available when no assignment is uploaded.
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
- Sends an uploaded assignment to the configured LiteLLM service for question generation but does not store it in this application.

## Files

- `index.html` - page structure and model/settings controls.
- `assignment-upload.js` - assignment upload, LiteLLM model selection, and preparation timing.
- `transformers-lab.js` - VAD, STT, TTS, interview flow, timing logs.
- `transformers-lab.css` - minimal microphone UI, transcript area, waveform, settings.
- `api/models.js` - secure LiteLLM model discovery endpoint.
- `api/generate-questions.js` - secure assignment-to-questions endpoint (cloud / LiteLLM).
- `api/generate-questions-local.js` - local model endpoint that calls Ollama (MiniCPM or any pulled model).
- `lib/question-prompt.js` - isolated question-generation prompt.
- `lib/extract-assignment.js` - PDF, DOCX, PPTX, and TXT text extraction. PPTX extracts slide text in slide-number order; images and legacy PPT files are not supported.
- `package.json` - Vite, Piper test, and document-extraction dependencies.

## LiteLLM Configuration

Copy `.env.example` to `.env.local` and provide your own values:

```text
LITELLM_BASE_URL=https://your-litellm-host
LITELLM_API_KEY=your-secret-key
LITELLM_MODEL=your-model-id
```

The base URL may end at the host, `/v1`, `/v1/models`, or `/v1/chat/completions`; the backend normalizes it automatically. The service must provide OpenAI-compatible model and chat-completion endpoints. Never put the key in browser JavaScript.

## Local Model (MiniCPM via Ollama)

The **Generate questions (Local MiniCPM)** button runs question generation entirely on your machine using [Ollama](https://ollama.com). No cloud credentials are required for this path.

### Prerequisites

1. Install Ollama: https://ollama.com/download
2. Pull the model (≈ 1.6 GB download on first run):
   ```bash
   ollama pull openbmb/minicpm5-2b
   ```
3. Ensure Ollama is serving:
   ```bash
   ollama serve
   ```

### Configuration (optional)

Add to `.env.local` to override defaults:

```text
LOCAL_MODEL=openbmb/minicpm5-2b    # any model you have pulled in Ollama
LOCAL_BASE_URL=http://localhost:11434/v1  # Ollama OpenAI-compatible API base
LOCAL_TIMEOUT_MS=300000            # inference timeout in ms (default 5 min)
```

### Timing comparison

After generating with both methods, the **Session Metrics** panel shows side-by-side timing:

| Metric | Cloud | Local |
|---|---|---|
| Extraction | `Cloud extraction` row | `Local extraction` row |
| Model inference | `Cloud model` row | `Local model` row |
| Total | `Cloud total` row | `Local total` row |

The extraction time should be nearly identical between both paths (it uses the same PDF/DOCX parser). The model inference time is what differs — local inference depends on your hardware (GPU acceleration via Ollama speeds this up significantly).

## Local Run

```bash
cd demo/browser-based-voice-interview
npm install
npm run dev
```

Open:

```text
http://localhost:7861/
```

The local Node server runs Vite and the two `/api` handlers together. Vercel CLI is not required for local testing.

## Vercel

Set `LITELLM_BASE_URL`, `LITELLM_API_KEY`, and `LITELLM_MODEL` in the Vercel project environment settings before deploying. Redeploy after adding or changing environment variables.

The browser downloads speech model assets from CDN/Hugging Face on first use, then uses browser cache. The Vercel functions extract assignment text and call LiteLLM without exposing the API key to the browser.
