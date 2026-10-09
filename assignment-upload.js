const fileInput = document.querySelector("#assignment-file");
const rubricFileInput = document.querySelector("#rubric-file");
const generateButton = document.querySelector("#generate-questions");
const uploadState = document.querySelector("#assignment-state");
const modelSelect = document.querySelector("#litellm-model");
const refreshModelsButton = document.querySelector("#refresh-models");

// Cloud timing stats
const extractionMetric = document.querySelector("#stat-question-extraction");
const modelMetric = document.querySelector("#stat-question-model");
const totalMetric = document.querySelector("#stat-question-total");

const questionPreview = document.querySelector("#question-preview");
const questionPreviewMeta = document.querySelector("#question-preview-meta");
const generatedQuestions = document.querySelector("#generated-questions");

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ["pdf", "docx", "pptx", "txt"];

async function readApiResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    const detail = text.trim().slice(0, 300);
    throw new Error(`Server returned a non-JSON response (${response.status}). ${detail || "Check the deployment function logs."}`);
  }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function setUploadState(message, kind = "") {
  uploadState.textContent = message;
  uploadState.className = `assignment-state ${kind}`.trim();
}

function formatMilliseconds(value) {
  return `${(value / 1000).toFixed(1)}s`;
}

function showGeneratedQuestions(questions, model, timing) {
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
  questionPreviewMeta.textContent = `${model} generated these questions in ${formatMilliseconds(timing.totalMs)}.`;
  
  // Show the preview section
  questionPreview.hidden = false;
}

function clearGeneratedQuestions() {
  generatedQuestions.replaceChildren();
  questionPreviewMeta.textContent = "";
  questionPreview.hidden = true;
  document.getElementById("extraction-preview").open = false;
  document.getElementById("extraction-preview").hidden = true;
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
  generateButton.disabled = generating;
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
    const payload = await readApiResponse(response);
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
    setUploadState(error.message, "error");
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
    formData.append("pdfMethod", "parser");
    if (modelSelect.value) formData.append("model", modelSelect.value);

    const response = await fetch("/api/generate-questions", {
      method: "POST",
      body: formData,
    });
    const payload = await readApiResponse(response);

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
      errorMessage = `PDF extraction failed. Original error: ${errorMessage}`;
    }
    setUploadState(errorMessage, "error");
  } finally {
    setGenerating(false);
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────

function updateFileSelectionState() {
  const file = fileInput.files?.[0];
  const rubricFile = rubricFileInput.files?.[0];
  if (file) {
    setUploadState(`${file.name} selected${rubricFile ? ` with ${rubricFile.name}` : ""}. Generate questions when ready.`);
  } else {
    setUploadState("Upload an assignment to generate questions.");
  }
}

fileInput.addEventListener("change", updateFileSelectionState);
rubricFileInput.addEventListener("change", updateFileSelectionState);

generateButton.addEventListener("click", generateQuestions);

refreshModelsButton.addEventListener("click", loadModels);

loadModels();
updateFileSelectionState();
