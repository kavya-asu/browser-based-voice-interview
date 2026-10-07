const fileInput = document.querySelector("#assignment-file");
const rubricFileInput = document.querySelector("#rubric-file");
const pdfMethodInputs = document.querySelectorAll('input[name="pdf-method"]');
const generateButton = document.querySelector("#generate-questions");
const generateLocalButton = document.querySelector("#generate-questions-local");
const generateWebLLMButton = document.querySelector("#generate-questions-webllm");
const defaultButton = document.querySelector("#use-default-questions");
const uploadState = document.querySelector("#assignment-state");
const modelSelect = document.querySelector("#litellm-model");
const webllmModelSelect = document.querySelector("#webllm-model");
const refreshModelsButton = document.querySelector("#refresh-models");

// Cloud timing stats
const extractionMetric = document.querySelector("#stat-question-extraction");
const modelMetric = document.querySelector("#stat-question-model");
const totalMetric = document.querySelector("#stat-question-total");

// Local timing stats
const localExtractionMetric = document.querySelector("#stat-local-extraction");
const localModelMetric = document.querySelector("#stat-local-model");
const localTotalMetric = document.querySelector("#stat-local-total");

// WebLLM timing stats
const webllmExtractionMetric = document.querySelector("#stat-webllm-extraction");
const webllmLoadMetric = document.querySelector("#stat-webllm-load");
const webllmInferenceMetric = document.querySelector("#stat-webllm-inference");
const webllmTotalMetric = document.querySelector("#stat-webllm-total");

const questionPreview = document.querySelector("#question-preview");
const questionPreviewMeta = document.querySelector("#question-preview-meta");
const generatedQuestions = document.querySelector("#generated-questions");

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ["pdf", "docx", "pptx", "txt"];

function setUploadState(message, kind = "") {
  uploadState.textContent = message;
  uploadState.className = `assignment-state ${kind}`.trim();
}

function formatMilliseconds(value) {
  return `${(value / 1000).toFixed(1)}s`;
}

function showGeneratedQuestions(questions, model, timing, source = "cloud") {
  // Ensure we have valid data
  if (!Array.isArray(questions) || questions.length === 0) {
    console.warn("No questions to display");
    return;
  }
  
  // Double-check that the container exists
  if (!generatedQuestions) {
    console.error("Generated questions container not found");
    return;
  }
  
  // Clear existing content completely
  generatedQuestions.replaceChildren();
  
  // Add new questions
  for (const question of questions) {
    const item = document.createElement("li");
    item.textContent = question;
    generatedQuestions.append(item);
  }
  
  // Update metadata
  const label = source === "local" ? `${model} (local)` : model;
  questionPreviewMeta.textContent = `${label} generated these questions in ${formatMilliseconds(timing.totalMs)}.`;
  
  // Show the preview section
  questionPreview.hidden = false;
}

function clearGeneratedQuestions() {
  generatedQuestions.replaceChildren();
  questionPreviewMeta.textContent = "";
  questionPreview.hidden = true;
}

// Function to show text extraction preview
function showExtractionPreview(text, method, extractionTime) {
  // Check if elements exist before trying to access them
  const previewElement = document.getElementById("extraction-preview");
  const methodElement = document.getElementById("extraction-method");
  const statsElement = document.getElementById("extraction-stats");
  const textElement = document.getElementById("extracted-text-preview");
  
  // If any elements are missing, don't try to show preview
  if (!previewElement || !methodElement || !statsElement || !textElement) {
    console.warn("Extraction preview elements not found in DOM");
    return;
  }
  
  if (text && text.trim()) {
    // Show the preview section
    previewElement.hidden = false;
    
    // Set method badge
    const methodName = method === "pptx" ? "PPTX Text" : method === "ai" ? "AI Extraction" : "PDF Parser";
    methodElement.textContent = methodName;
    methodElement.className = "badge " + (method === "ai" ? "ai-method" : "parser-method");
    
    // Set stats
    statsElement.textContent = `${Math.round(extractionTime)}ms • ${text.length} chars`;
    
    // Set extracted text (limit to prevent UI issues)
    const displayText = text.length > 2000 ? text.substring(0, 2000) + "..." : text;
    textElement.value = displayText;
  } else {
    // Hide preview if no text
    previewElement.hidden = true;
  }
}

function setGenerating(generating) {
  fileInput.disabled = generating;
  rubricFileInput.disabled = generating;
  pdfMethodInputs.forEach(input => input.disabled = generating || !fileInput.files?.[0]?.name.toLowerCase().endsWith(".pdf"));
  generateButton.disabled = generating;
  generateLocalButton.disabled = generating;
  generateWebLLMButton.disabled = generating;
  webllmModelSelect.disabled = generating;
  defaultButton.disabled = generating;
  refreshModelsButton.disabled = generating;
  window.dispatchEvent(new CustomEvent("assignment-generation-state", {
    detail: { generating },
  }));
}

async function loadModels() {
  refreshModelsButton.disabled = true;
  const previous = modelSelect.value;
  try {
    const response = await fetch("/api/models");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load LiteLLM models.");
    modelSelect.replaceChildren();
    for (const model of payload.models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelSelect.append(option);
    }
    const preferred = previous || payload.defaultModel;
    if (preferred && payload.models.includes(preferred)) modelSelect.value = preferred;
    if (!payload.models.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No models returned";
      modelSelect.append(option);
    }
  } catch (error) {
    setUploadState(`${error.message} Default questions are still available.`, "error");
  } finally {
    refreshModelsButton.disabled = false;
  }
}

/** Validate the selected file and return it, or null with an error state set. */
function getValidatedFile() {
  const file = fileInput.files?.[0];
  if (!file) {
    setUploadState("Choose an assignment first.", "error");
    return null;
  }
  const extension = file.name.toLowerCase().split(".").pop();
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    setUploadState("Upload a PDF, DOCX, PPTX, or TXT assignment.", "error");
    return null;
  }
  if (file.size > MAX_FILE_BYTES) {
    setUploadState("Assignment must be 3 MB or smaller.", "error");
    return null;
  }
  return file;
}

// ─── Cloud generation ──────────────────────────────────────────────────────

async function generateQuestions() {
  const file = getValidatedFile();
  const rubricFile = rubricFileInput.files?.[0];
  const pdfMethod = document.querySelector('input[name="pdf-method"]:checked')?.value || "parser";
  if (!file) return;

  setGenerating(true);
  clearGeneratedQuestions();
  setUploadState("Reading assignment and generating questions (cloud)...", "busy");
  extractionMetric.textContent = "running";
  modelMetric.textContent = "running";
  totalMetric.textContent = "running";

  try {
    const formData = new FormData();
    formData.append("assignment", file);
    if (rubricFile) {
      formData.append("rubric", rubricFile);
    }
    formData.append("pdfMethod", pdfMethod);

    const headers = {
      "X-File-Name": encodeURIComponent(file.name),
    };
    if (modelSelect.value) headers["X-LiteLLM-Model"] = encodeURIComponent(modelSelect.value);
    const response = await fetch("/api/generate-questions", {
      method: "POST",
      headers,
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Question generation failed.");

    // Show extraction preview
    showExtractionPreview(payload.extractedText, file.name.toLowerCase().endsWith(".pptx") ? "pptx" : payload.extractionMethod, payload.timing.extractionMs);
    
    extractionMetric.textContent = formatMilliseconds(payload.timing.extractionMs);
    modelMetric.textContent = formatMilliseconds(payload.timing.modelMs);
    totalMetric.textContent = formatMilliseconds(payload.timing.totalMs);
    setUploadState(`Five questions ready using ${payload.model} (cloud).`, "ok");
    showGeneratedQuestions(payload.questions, payload.model, payload.timing, "cloud");
    window.dispatchEvent(new CustomEvent("assignment-questions-ready", {
      detail: { questions: payload.questions, model: payload.model },
    }));
  } catch (error) {
    extractionMetric.textContent = "failed";
    modelMetric.textContent = "failed";
    totalMetric.textContent = "failed";
    
    // Enhanced error handling with more user-friendly messages
    let errorMessage = error.message;
    if (errorMessage.includes("AI extraction") || errorMessage.includes("image format") || 
        errorMessage.includes("Unsupported image format")) {
      errorMessage = `AI PDF extraction failed. Your current model doesn't support PDF files directly. Try switching to 'PDF Parser' method for reliable PDF text extraction. Original error: ${errorMessage}`;
    }
    setUploadState(`${errorMessage} You can use the default questions instead.`, "error");
  } finally {
    setGenerating(false);
  }
}

// ─── Local model generation (MiniCPM via Ollama) ──────────────────────────

async function generateQuestionsLocal() {
  const file = getValidatedFile();
  const rubricFile = rubricFileInput.files?.[0];
  const pdfMethod = document.querySelector('input[name="pdf-method"]:checked')?.value || "parser";
  if (!file) return;

  setGenerating(true);
  clearGeneratedQuestions();
  setUploadState("Reading assignment and generating questions (local MiniCPM)...", "busy");
  localExtractionMetric.textContent = "running";
  localModelMetric.textContent = "running";
  localTotalMetric.textContent = "running";

  try {
    const formData = new FormData();
    formData.append("assignment", file);
    if (rubricFile) {
      formData.append("rubric", rubricFile);
    }
    formData.append("pdfMethod", pdfMethod);

    const headers = {
      "X-File-Name": encodeURIComponent(file.name),
    };
    const response = await fetch("/api/generate-questions-local", {
      method: "POST",
      headers,
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Local question generation failed.");

    // Show extraction preview
    showExtractionPreview(payload.extractedText, file.name.toLowerCase().endsWith(".pptx") ? "pptx" : payload.extractionMethod, payload.timing.extractionMs);
    
    localExtractionMetric.textContent = formatMilliseconds(payload.timing.extractionMs);
    localModelMetric.textContent = formatMilliseconds(payload.timing.modelMs);
    localTotalMetric.textContent = formatMilliseconds(payload.timing.totalMs);
    setUploadState(`Five questions ready using ${payload.model} (local).`, "ok");
    showGeneratedQuestions(payload.questions, payload.model, payload.timing, "local");
    window.dispatchEvent(new CustomEvent("assignment-questions-ready", {
      detail: { questions: payload.questions, model: payload.model },
    }));
  } catch (error) {
    localExtractionMetric.textContent = "failed";
    localModelMetric.textContent = "failed";
    localTotalMetric.textContent = "failed";
    setUploadState(`${error.message} You can use the default questions instead.`, "error");
  } finally {
    setGenerating(false);
  }
}

// ─── WebLLM generation (browser-side inference via WebGPU) ────────────────

/** Cached engine instance — reused if the same model is loaded again. */
let webllmEngine = null;
let webllmLoadedModel = null;

function parseQuestionsWebLLM(content) {
  const raw = typeof content === "string" ? content : "";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("WebLLM did not return JSON questions.");
  }
  const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  const questions = parsed.questions
    ?.map((q) => String(q).trim())
    .filter(Boolean);
  if (!Array.isArray(questions) || questions.length !== 3) {
    throw new Error("WebLLM must return exactly three questions.");
  }
  return questions;
}

async function generateQuestionsWebLLM() {
  const file = getValidatedFile();
  if (!file) return;

  if (!navigator.gpu) {
    setUploadState(
      "WebGPU is not available in this browser. Try Chrome 113+ on desktop.",
      "error",
    );
    return;
  }

  const selectedModel = webllmModelSelect.value;
  const totalStarted = performance.now();

  setGenerating(true);
  clearGeneratedQuestions();
  setUploadState("Extracting assignment text…", "busy");
  webllmExtractionMetric.textContent = "running";
  webllmLoadMetric.textContent = "—";
  webllmInferenceMetric.textContent = "—";
  webllmTotalMetric.textContent = "running";

  try {
    // ── Step 1: extract text server-side ──────────────────────────────────
    const headers = {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    };
    const extractResponse = await fetch("/api/extract-text", {
      method: "POST",
      headers,
      body: file,
    });
    const extractPayload = await extractResponse.json();
    if (!extractResponse.ok) {
      throw new Error(extractPayload.error || "Text extraction failed.");
    }
    const { text: assignmentText, timing: extractTiming } = extractPayload;
    webllmExtractionMetric.textContent = formatMilliseconds(extractTiming.extractionMs);

    // ── Step 2: load WebLLM engine (or reuse cached) ──────────────────────
    const webllm = await import("https://esm.run/@mlc-ai/web-llm");

    let loadMs = 0;
    if (webllmEngine && webllmLoadedModel === selectedModel) {
      setUploadState(`Model ${selectedModel} already loaded. Running inference…`, "busy");
      webllmLoadMetric.textContent = "cached";
    } else {
      setUploadState(`Loading ${selectedModel} into browser (first load may take a while)…`, "busy");
      webllmLoadMetric.textContent = "loading…";
      const loadStarted = performance.now();

      // Unload previous engine if a different model was cached
      if (webllmEngine) {
        await webllmEngine.unload();
        webllmEngine = null;
        webllmLoadedModel = null;
      }

      webllmEngine = await webllm.CreateMLCEngine(selectedModel, {
        initProgressCallback: (progress) => {
          const pct = progress.progress != null
            ? ` (${Math.round(progress.progress * 100)}%)`
            : "";
          setUploadState(
            `Loading ${selectedModel}${pct} — ${progress.text ?? ""}`,
            "busy",
          );
        },
      });
      webllmLoadedModel = selectedModel;
      loadMs = Math.round(performance.now() - loadStarted);
      webllmLoadMetric.textContent = formatMilliseconds(loadMs);
    }

    // ── Step 3: run inference with the same question-generation prompt ─────
    const { QUESTION_SYSTEM_PROMPT, buildQuestionPrompt } = await import(
      "./lib/question-prompt.js"
    );

    setUploadState("Running inference with WebLLM…", "busy");
    webllmInferenceMetric.textContent = "running";
    const inferenceStarted = performance.now();

    const completion = await webllmEngine.chat.completions.create({
      messages: [
        { role: "system", content: QUESTION_SYSTEM_PROMPT },
        { role: "user", content: buildQuestionPrompt(assignmentText) },
      ],
      temperature: 0.25,
      max_tokens: 500,
    });

    const inferenceMs = Math.round(performance.now() - inferenceStarted);
    webllmInferenceMetric.textContent = formatMilliseconds(inferenceMs);

    const rawContent = completion.choices?.[0]?.message?.content ?? "";
    const questions = parseQuestionsWebLLM(rawContent);
    const totalMs = Math.round(performance.now() - totalStarted);
    webllmTotalMetric.textContent = formatMilliseconds(totalMs);

    const timing = { extractionMs: extractTiming.extractionMs, inferenceMs, totalMs };
    setUploadState(`Five questions ready using ${selectedModel} (WebLLM).`, "ok");
    showGeneratedQuestions(questions, selectedModel, { totalMs }, "webllm");
    window.dispatchEvent(new CustomEvent("assignment-questions-ready", {
      detail: { questions, model: selectedModel },
    }));
  } catch (error) {
    webllmExtractionMetric.textContent =
      webllmExtractionMetric.textContent === "running" ? "failed" : webllmExtractionMetric.textContent;
    webllmLoadMetric.textContent =
      webllmLoadMetric.textContent === "loading…" ? "failed" : webllmLoadMetric.textContent;
    webllmInferenceMetric.textContent =
      webllmInferenceMetric.textContent === "running" ? "failed" : webllmInferenceMetric.textContent;
    webllmTotalMetric.textContent = "failed";
    setUploadState(`${error.message} You can use the default questions instead.`, "error");
    // If the engine is in a broken state, clear it so the next attempt reloads
    if (webllmEngine) {
      try { await webllmEngine.unload(); } catch (_) { /* ignore */ }
      webllmEngine = null;
      webllmLoadedModel = null;
    }
  } finally {
    setGenerating(false);
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────

function updateFileSelectionState() {
  const file = fileInput.files?.[0];
  const rubricFile = rubricFileInput.files?.[0];
  const pdfMethod = document.querySelector('input[name="pdf-method"]:checked')?.value || "parser";
  pdfMethodInputs.forEach(input => input.disabled = !file?.name.toLowerCase().endsWith(".pdf"));
  if (file) {
    const method = file.name.toLowerCase().endsWith(".pdf")
      ? ` using ${pdfMethod === "ai" ? "AI" : "PDF parser"} extraction`
      : file.name.toLowerCase().endsWith(".pptx") ? " using PPTX text extraction" : "";
    setUploadState(`${file.name} selected${rubricFile ? ` with ${rubricFile.name}` : ""}${method}. Generate questions when ready.`);
  } else {
    setUploadState("Default questions are ready.");
  }
}

fileInput.addEventListener("change", updateFileSelectionState);
rubricFileInput.addEventListener("change", updateFileSelectionState);

// Add event listener for PDF method changes
pdfMethodInputs.forEach(input => {
  input.addEventListener("change", updateFileSelectionState);
});

generateButton.addEventListener("click", generateQuestions);
generateLocalButton.addEventListener("click", generateQuestionsLocal);
generateWebLLMButton.addEventListener("click", generateQuestionsWebLLM);

defaultButton.addEventListener("click", () => {
  extractionMetric.textContent = "0.0s";
  modelMetric.textContent = "0.0s";
  totalMetric.textContent = "0.0s";
  clearGeneratedQuestions();
  setUploadState("Using the default interview questions.", "ok");
  window.dispatchEvent(new CustomEvent("assignment-use-default-questions"));
});

refreshModelsButton.addEventListener("click", loadModels);

loadModels();
updateFileSelectionState();
