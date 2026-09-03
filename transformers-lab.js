// @ts-check
import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";

env.allowLocalModels = false;
env.useBrowserCache = true;

const $ = (/** @type {string} */ selector) => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
};

const ttsModelInput = /** @type {HTMLInputElement} */ ($("#tts-model"));
const ttsEngine = /** @type {HTMLSelectElement} */ ($("#tts-engine"));
const ttsVoice = /** @type {HTMLSelectElement} */ ($("#tts-voice"));
const browserVoice = /** @type {HTMLSelectElement} */ ($("#browser-voice"));
const kokoroVoiceField = /** @type {HTMLElement} */ ($("#kokoro-voice-field"));
const browserVoiceField = /** @type {HTMLElement} */ ($("#browser-voice-field"));
const sttModel = /** @type {HTMLSelectElement} */ ($("#stt-model"));
const runtime = /** @type {HTMLSelectElement} */ ($("#runtime"));
const captureMode = /** @type {HTMLSelectElement} */ ($("#capture-mode"));
const loadModelsButton = /** @type {HTMLButtonElement} */ ($("#load-models"));
const speakButton = /** @type {HTMLButtonElement} */ ($("#speak"));
const stopAudioButton = /** @type {HTMLButtonElement} */ ($("#stop-audio"));
const recordButton = /** @type {HTMLButtonElement} */ ($("#record"));
const clearLogButton = /** @type {HTMLButtonElement} */ ($("#clear-log"));
const autoReply = /** @type {HTMLInputElement} */ ($("#auto-reply"));
const ttsText = /** @type {HTMLTextAreaElement} */ ($("#tts-text"));
const transcript = /** @type {HTMLTextAreaElement} */ ($("#transcript"));
const ttsAudio = /** @type {HTMLAudioElement} */ ($("#tts-audio"));
const ttsWaveform = /** @type {HTMLCanvasElement} */ ($("#tts-waveform"));
const ttsState = /** @type {HTMLElement} */ ($("#tts-state"));
const sttState = /** @type {HTMLElement} */ ($("#stt-state"));
const conversationState = /** @type {HTMLElement} */ ($("#conversation-state"));
const recordingTime = /** @type {HTMLElement} */ ($("#recording-time"));
const sttTiming = /** @type {HTMLElement} */ ($("#stt-timing"));
const statVadWait = /** @type {HTMLElement} */ ($("#stat-vad-wait"));
const statSpeech = /** @type {HTMLElement} */ ($("#stat-speech"));
const statVadEnd = /** @type {HTMLElement} */ ($("#stat-vad-end"));
const statStt = /** @type {HTMLElement} */ ($("#stat-stt"));
const statTtsStart = /** @type {HTMLElement} */ ($("#stat-tts-start"));
const statTtsSpeak = /** @type {HTMLElement} */ ($("#stat-tts-speak"));
const log = /** @type {HTMLOListElement} */ ($("#log"));
const errorBox = /** @type {HTMLPreElement} */ ($("#error-box"));

/** @type {any} */
let ttsPipe = null;
/** @type {any} */
let sttPipe = null;
let loadedTtsKey = "";
let loadedSttKey = "";
let loadedTtsRuntime = "";
let loadedSttRuntime = "";
/** @type {Float32Array | null} */
let lastWaveform = null;
/** @type {any} */
let micVad = null;
let vadListening = false;
let vadSpeechStartedAt = 0;
let vadListenStartedAt = 0;
let lastVadWaitSeconds = 0;
let lastVadSegmentSeconds = 0;
let lastVadEndDelaySeconds = 0;
let lastTurnStartedAt = 0;
/** @type {number | undefined} */
let timerId;
let startedAt = 0;
let lastRecordingSeconds = 0;
let lastTranscriptionSeconds = 0;
let transcribedCurrentRecording = false;
let interviewStarted = false;
let questionIndex = 0;
let interviewComplete = false;
/** @type {AudioContext | null} */
let playbackContext = null;
/** @type {AnalyserNode | null} */
let playbackAnalyser = null;
let playbackSourceConnected = false;
/** @type {number | undefined} */
let waveformFrameId;
let lastTtsStartDelaySeconds = 0;

const INTERVIEW_INTRO =
  "Thank you for submitting your assignment. I'm going to ask you three questions about your submission. Please answer each question through voice.";
const INTERVIEW_QUESTIONS = [
  "Can you briefly explain the approach you used to solve the problem?",
  "Thank you. Why did you choose this particular approach?",
  "Thank you. If you had more time to improve your assignment, what would you change?",
];
const INTERVIEW_CLOSING = "Thank you. That completes the interview.";

function setState(el, text, kind = "") {
  el.textContent = text;
  el.className = `state ${kind}`.trim();
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function showError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function setBusy(busy) {
  for (const button of [loadModelsButton, speakButton, recordButton]) {
    button.disabled = busy;
  }
}

function updateStats({
  vadWait = lastVadWaitSeconds,
  speech = lastRecordingSeconds,
  vadEnd = lastVadEndDelaySeconds,
  stt = lastTranscriptionSeconds,
  ttsStart = lastTtsStartDelaySeconds,
  ttsSpeak = 0,
} = {}) {
  statVadWait.textContent = formatSeconds(vadWait);
  statSpeech.textContent = formatSeconds(speech);
  statVadEnd.textContent = formatSeconds(vadEnd);
  statStt.textContent = stt === null ? "running" : formatSeconds(stt);
  statTtsStart.textContent = formatSeconds(ttsStart);
  statTtsSpeak.textContent = formatSeconds(ttsSpeak);
}

function drawIdleWaveform() {
  const ctx = ttsWaveform.getContext("2d");
  if (!ctx) return;
  const { width, height } = ttsWaveform;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(154, 163, 178, 0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

function startWaveform() {
  const ctx = ttsWaveform.getContext("2d");
  if (!ctx) return;
  playbackContext ||= new AudioContext();
  playbackAnalyser ||= playbackContext.createAnalyser();
  playbackAnalyser.fftSize = 256;
  if (!playbackSourceConnected) {
    const source = playbackContext.createMediaElementSource(ttsAudio);
    source.connect(playbackAnalyser);
    playbackAnalyser.connect(playbackContext.destination);
    playbackSourceConnected = true;
  }
  playbackContext.resume().catch(() => {});
  const data = new Uint8Array(playbackAnalyser.frequencyBinCount);

  const draw = () => {
    if (!playbackAnalyser) return;
    playbackAnalyser.getByteFrequencyData(data);
    const { width, height } = ttsWaveform;
    ctx.clearRect(0, 0, width, height);
    const barWidth = width / data.length;
    for (let i = 0; i < data.length; i += 1) {
      const value = data[i] / 255;
      const barHeight = Math.max(3, value * height * 0.9);
      const x = i * barWidth;
      const y = (height - barHeight) / 2;
      ctx.fillStyle = `rgba(67, 211, 255, ${0.25 + value * 0.75})`;
      ctx.fillRect(x, y, Math.max(2, barWidth - 2), barHeight);
    }
    waveformFrameId = requestAnimationFrame(draw);
  };

  if (waveformFrameId) cancelAnimationFrame(waveformFrameId);
  waveformFrameId = requestAnimationFrame(draw);
}

function stopWaveform() {
  if (waveformFrameId) cancelAnimationFrame(waveformFrameId);
  waveformFrameId = undefined;
  drawIdleWaveform();
}

function setCaptureButton() {
  if (!interviewStarted || interviewComplete) {
    recordButton.textContent = "Start interview";
    recordButton.disabled = false;
    return;
  }
  if (captureMode.value === "vad") {
    recordButton.textContent = vadListening ? "Stop VAD" : "Start VAD";
  }
}

function syncTtsSettings() {
  const useKokoro = ttsEngine.value === "kokoro";
  kokoroVoiceField.hidden = !useKokoro;
  browserVoiceField.hidden = useKokoro;
  setState(ttsState, useKokoro ? "kokoro" : "browser tts", "ok");
}

function runtimeOptions() {
  const device = runtime.value;
  if (device === "webgpu") return { device: "webgpu", dtype: "q4" };
  if (device === "wasm") return { device: "wasm", dtype: "q4" };
  return { dtype: "q4" };
}

async function ensureTts() {
  const ttsKey = ttsModelInput.value.trim();
  const runKey = runtime.value;

  if (!ttsPipe || loadedTtsKey !== ttsKey || loadedTtsRuntime !== runKey) {
    setState(ttsState, "loading", "busy");
    ttsPipe = await KokoroTTS.from_pretrained(ttsKey, kokoroOptions());
    loadedTtsKey = ttsKey;
    loadedTtsRuntime = runKey;
    setState(ttsState, "ready", "ok");
  }
}

function kokoroOptions() {
  if (runtime.value === "webgpu") return { device: "webgpu", dtype: "fp32" };
  return { device: "wasm", dtype: "q8" };
}

async function ensureStt() {
  const sttKey = sttModel.value;
  const runKey = runtime.value;

  if (!sttPipe || loadedSttKey !== sttKey || loadedSttRuntime !== runKey) {
    setState(sttState, "loading", "busy");
    sttPipe = await pipeline("automatic-speech-recognition", sttKey, runtimeOptions());
    loadedSttKey = sttKey;
    loadedSttRuntime = runKey;
    setState(sttState, "ready", "ok");
  }
}

async function ensureModels() {
  setBusy(true);
  clearError();
  try {
    await Promise.all([ttsEngine.value === "kokoro" ? ensureTts() : Promise.resolve(), ensureStt()]);
  } catch (error) {
    showError(error);
    setState(ttsState, "error", "error");
    setState(sttState, "error", "error");
    throw error;
  } finally {
    setBusy(false);
  }
}

async function speak(text) {
  clearError();
  const cleanText = text.trim();
  if (!cleanText) return;

  setBusy(true);
  setState(ttsState, ttsEngine.value === "kokoro" ? "generating" : "speaking", "busy");
  try {
    const started = performance.now();
    if (ttsEngine.value === "speech") {
      await speakWithBrowser(cleanText, started);
      setState(ttsState, "speaking", "ok");
      return (performance.now() - started) / 1000;
    }

    await ensureTts();
    const audio = await ttsPipe.generate(cleanText, { voice: ttsVoice.value });
    lastTtsStartDelaySeconds = (performance.now() - started) / 1000;
    const blob = audio?.toBlob ? await audio.toBlob() : wavBlob(audio.audio ?? audio, audio.sampling_rate ?? 24000);
    URL.revokeObjectURL(ttsAudio.src);
    ttsAudio.src = URL.createObjectURL(blob);
    await ttsAudio.play();
    setState(ttsState, "speaking", "ok");
    return (performance.now() - started) / 1000;
  } catch (error) {
    showError(error);
    setState(ttsState, "error", "error");
    throw error;
  } finally {
    setBusy(false);
  }
}

function speakWithBrowser(text, requestedAt = performance.now()) {
  if (!("speechSynthesis" in window)) {
    throw new Error("Browser SpeechSynthesis is not available in this browser.");
  }
  return new Promise((resolve, reject) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const selected = speechSynthesis.getVoices().find((voice) => voice.voiceURI === browserVoice.value);
    if (selected) utterance.voice = selected;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => {
      lastTtsStartDelaySeconds = (performance.now() - requestedAt) / 1000;
      startSyntheticWaveform();
    };
    utterance.onend = () => {
      stopWaveform();
      resolve();
    };
    utterance.onerror = (event) => {
      stopWaveform();
      reject(new Error(`SpeechSynthesis failed: ${event.error}`));
    };
    window.speechSynthesis.speak(utterance);
  });
}

function loadBrowserVoices() {
  const voices = speechSynthesis.getVoices();
  const current = browserVoice.value;
  browserVoice.replaceChildren();
  for (const voice of voices) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} · ${voice.lang}`;
    browserVoice.append(option);
  }
  const preferred =
    voices.find((voice) => voice.voiceURI === current) ||
    voices.find((voice) => voice.lang.toLowerCase() === "en-us") ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en-us")) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
  if (preferred) browserVoice.value = preferred.voiceURI;
}

function startSyntheticWaveform() {
  const ctx = ttsWaveform.getContext("2d");
  if (!ctx) return;
  let phase = 0;
  const draw = () => {
    const { width, height } = ttsWaveform;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(67, 211, 255, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x < width; x += 1) {
      const amp = 16 + 8 * Math.sin(phase / 17);
      const y = height / 2 + Math.sin(x / 18 + phase / 10) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    phase += 1;
    waveformFrameId = requestAnimationFrame(draw);
  };
  if (waveformFrameId) cancelAnimationFrame(waveformFrameId);
  waveformFrameId = requestAnimationFrame(draw);
}

function wavBlob(samplesLike, sampleRate) {
  const samples = samplesLike instanceof Float32Array ? samplesLike : new Float32Array(samplesLike);
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

async function startVad() {
  clearError();
  await ensureVad();
  if (!interviewStarted || interviewComplete) {
    await startInterview();
  }
  vadListening = true;
  startedAt = Date.now();
  vadListenStartedAt = performance.now();
  lastTurnStartedAt = vadListenStartedAt;
  lastVadWaitSeconds = 0;
  lastVadSegmentSeconds = 0;
  lastVadEndDelaySeconds = 0;
  timerId = window.setInterval(updateTimer, 250);
  setCaptureButton();
  setState(sttState, "vad listening", "busy");
  setState(conversationState, "waiting for speech", "busy");
  await micVad.start();
}

async function stopVad() {
  if (!micVad || !vadListening) return;
  await micVad.pause();
  vadListening = false;
  window.clearInterval(timerId);
  recordingTime.textContent = "00:00";
  setCaptureButton();
  setState(sttState, "ready", "ok");
  setState(conversationState, "ready", "ok");
}

async function ensureVad() {
  if (micVad) return;
  if (!globalThis.vad?.MicVAD) {
    throw new Error("Silero VAD bundle did not load. Check network access to jsDelivr.");
  }
  setState(sttState, "loading vad", "busy");
  micVad = await globalThis.vad.MicVAD.new({
    model: "v5",
    baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/",
    onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/",
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    minSpeechMs: 250,
    redemptionMs: 800,
    preSpeechPadMs: 200,
    onSpeechStart: () => {
      vadSpeechStartedAt = performance.now();
      lastTurnStartedAt = vadSpeechStartedAt;
      lastVadWaitSeconds = vadListenStartedAt ? (vadSpeechStartedAt - vadListenStartedAt) / 1000 : 0;
      setState(sttState, "speech detected", "busy");
      setState(conversationState, "hearing speech", "busy");
    },
    onVADMisfire: () => {
      setState(sttState, "vad listening", "busy");
      setState(conversationState, "waiting for speech", "busy");
    },
    onSpeechEnd: (audio) => {
      handleVadSpeechEnd(audio).catch((error) => {
        showError(error);
        setState(sttState, "error", "error");
        setState(conversationState, "error", "error");
      });
    },
  });
  setState(sttState, "vad ready", "ok");
}

async function handleVadSpeechEnd(audio) {
  const shouldResumeVad = vadListening;
  if (micVad && vadListening) await micVad.pause();
  lastWaveform = audio;
  lastRecordingSeconds = audio.length / 16000;
  transcribedCurrentRecording = false;
  lastVadSegmentSeconds = vadSpeechStartedAt ? (performance.now() - vadSpeechStartedAt) / 1000 : 0;
  lastVadEndDelaySeconds = Math.max(0, lastVadSegmentSeconds - lastRecordingSeconds);
  const answerItem = addLog("You", "Transcribing...");
  const nextQuestionIndex = advanceInterviewIndex();
  const isFinalTurn = nextQuestionIndex >= INTERVIEW_QUESTIONS.length;
  const reply = INTERVIEW_QUESTIONS[nextQuestionIndex] ?? INTERVIEW_CLOSING;
  if (isFinalTurn) {
    interviewComplete = true;
    vadListening = false;
    window.clearInterval(timerId);
    recordingTime.textContent = "00:00";
    setCaptureButton();
    setState(conversationState, "complete", "ok");
  }
  updateStats({ stt: null, ttsStart: 0, ttsSpeak: 0 });
  sttTiming.textContent = "Transcribing...";
  transcribeInBackground(audio, answerItem);
  let ttsSeconds = 0;
  let botStartedAfterSeconds = 0;
  if (autoReply.checked) {
    ttsSeconds = await botSpeak(reply);
    botStartedAfterSeconds = Math.max(0, lastTtsStartDelaySeconds);
    updateStats({ stt: null, ttsStart: botStartedAfterSeconds, ttsSpeak: ttsSeconds ?? 0 });
  }
  if (shouldResumeVad && !interviewComplete) {
    vadListenStartedAt = performance.now();
    await micVad.start();
    setState(sttState, "vad listening", "busy");
    setState(conversationState, "waiting for speech", "busy");
  } else if (interviewComplete) {
    await micVad?.pause();
    setState(sttState, "ready", "ok");
    setState(conversationState, "complete", "ok");
  }
}

function advanceInterviewIndex() {
  questionIndex += 1;
  return questionIndex;
}

function transcribeInBackground(audio, answerItem) {
  setState(sttState, "transcribing", "busy");
  return transcribe(audio, { background: true })
    .then((seconds) => {
      lastTranscriptionSeconds = seconds;
      transcribedCurrentRecording = true;
      const text = transcript.value.trim() || "(no speech text detected)";
      updateLogItem(answerItem, "You", text);
      updateStats({ stt: seconds });
      sttTiming.textContent = "Transcript ready";
      if (vadListening) {
        setState(sttState, "vad listening", "busy");
      }
    })
    .catch((error) => {
      showError(error);
      updateLogItem(answerItem, "You", "Transcription failed");
      setState(sttState, "error", "error");
    });
}

function updateTimer() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  recordingTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function transcribe(waveform, { background = false } = {}) {
  clearError();
  await ensureStt();
  if (!background) setBusy(true);
  setState(sttState, "transcribing", "busy");
  try {
    const started = performance.now();
    const result = await sttPipe(waveform, {
      language: "english",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    transcript.value = result.text?.trim() || "";
    const seconds = (performance.now() - started) / 1000;
    sttTiming.textContent = "Transcript ready";
    if (!background) setState(sttState, "ready", "ok");
    return seconds;
  } catch (error) {
    showError(error);
    setState(sttState, "error", "error");
    throw error;
  } finally {
    if (!background) setBusy(false);
  }
}

function addLog(role, text) {
  const item = document.createElement("li");
  item.innerHTML = `<strong>${role}:</strong> ${escapeHtml(text)}`;
  log.append(item);
  log.scrollTop = log.scrollHeight;
  return item;
}

function updateLogItem(item, role, text) {
  item.innerHTML = `<strong>${role}:</strong> ${escapeHtml(text)}`;
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char] || char);
}

async function startInterview() {
  interviewStarted = true;
  interviewComplete = false;
  questionIndex = 0;
  transcript.value = "";
  sttTiming.textContent = "No transcription yet";
  updateStats({ vadWait: 0, speech: 0, vadEnd: 0, stt: 0, ttsStart: 0, ttsSpeak: 0 });
  log.replaceChildren();
  addLog("Bot", INTERVIEW_INTRO);
  addLog("Bot", INTERVIEW_QUESTIONS[questionIndex]);
  await speak(`${INTERVIEW_INTRO} ${INTERVIEW_QUESTIONS[questionIndex]}`);
  setCaptureButton();
}

async function botSpeak(text) {
  addLog("Bot", text);
  return speak(text);
}

function formatSeconds(seconds) {
  return `${seconds.toFixed(1)}s`;
}

loadModelsButton.addEventListener("click", () => ensureModels().catch(console.error));
speakButton.addEventListener("click", () => speak(ttsText.value).catch(console.error));
stopAudioButton.addEventListener("click", () => {
  ttsAudio.pause();
  ttsAudio.currentTime = 0;
  window.speechSynthesis?.cancel();
  setState(ttsState, "ready", "ok");
});
ttsAudio.addEventListener("play", startWaveform);
ttsAudio.addEventListener("pause", stopWaveform);
ttsAudio.addEventListener("ended", stopWaveform);
recordButton.addEventListener("click", () => {
  if (captureMode.value === "vad") {
    if (vadListening) {
      stopVad().catch(console.error);
    } else {
      startVad().catch((error) => {
        showError(error);
        setState(sttState, "vad error", "error");
        console.error(error);
      });
    }
  } else {
    startVad().catch(console.error);
  }
});
captureMode.addEventListener("change", () => {
  if (vadListening) stopVad().catch(console.error);
  setCaptureButton();
});
clearLogButton.addEventListener("click", () => log.replaceChildren());
ttsEngine.addEventListener("change", syncTtsSettings);
if ("speechSynthesis" in window) {
  loadBrowserVoices();
  window.speechSynthesis.addEventListener("voiceschanged", loadBrowserVoices);
}
setCaptureButton();
syncTtsSettings();
updateStats({ vadWait: 0, speech: 0, vadEnd: 0, stt: 0, ttsStart: 0, ttsSpeak: 0 });
drawIdleWaveform();
