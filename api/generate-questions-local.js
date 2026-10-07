import { extractAssignmentText } from "../lib/extract-assignment.js";
import { buildQuestionPrompt, QUESTION_SYSTEM_PROMPT } from "../lib/question-prompt.js";
import formidable from "formidable";

const MAX_FILE_BYTES = 3 * 1024 * 1024;

const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_MODEL = "openbmb/minicpm5-2b";
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes — local inference can slow

function localBaseUrl() {
  return (process.env.LOCAL_BASE_URL ?? "").trim().replace(/\/$/, "") || DEFAULT_BASE_URL;
}

function localModel() {
  return (process.env.LOCAL_MODEL ?? "").trim() || DEFAULT_MODEL;
}

function localTimeoutMs() {
  const v = Number(process.env.LOCAL_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

function repairAndParseQuestions(raw) {
  // Strip markdown code fences
  let text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // Find the opening brace
  const firstBrace = text.indexOf("{");
  if (firstBrace < 0) return null;
  text = text.slice(firstBrace);

  // Try parsing as-is first (clean path)
  try {
    const parsed = JSON.parse(text);
    const questions = parsed.questions?.map((q) => String(q).trim()).filter(Boolean);
    if (Array.isArray(questions) && questions.length === 5) return questions;
  } catch {
    // fall through to repair
  }

  // The JSON is likely truncated — extract whatever complete quoted strings exist
  // inside the "questions" array using a regex that matches complete JSON strings.
  const arrayMatch = text.match(/"questions"\s*:\s*\[([^\]]*)/s);
  if (arrayMatch) {
    // Match all complete "..." string values (handles escaped quotes inside)
    const stringPattern = /"((?:[^"\\]|\\.)*)"/g;
    const items = [];
    let m;
    while ((m = stringPattern.exec(arrayMatch[1])) !== null) {
      const q = m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
      if (q.length > 10) items.push(q);
    }
    if (items.length >= 5) return items.slice(0, 5);
    if (items.length > 0) return null; // partial — don't return fewer than 5
  }

  // Last resort: numbered list lines
  const listLines = raw
    .split("\n")
    .map((line) => line.replace(/^\s*\d+[\.\)]\s*/, "").trim())
    .filter((line) => line.length > 10);
  if (listLines.length >= 5) return listLines.slice(0, 5);

  return null;
}

function parseQuestions(content) {
  const raw = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part.text ?? "").join("")
      : "";

  const questions = repairAndParseQuestions(raw);
  if (!questions) {
    throw new Error(
      "Local model did not return parseable questions. Raw output: " + raw.slice(0, 400)
    );
  }
  return questions;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed." });
  }

  const totalStarted = performance.now();
  try {
    // Handle multipart form data
    const form = formidable({
      multiples: true,
      maxFileSize: MAX_FILE_BYTES,
      maxFieldsSize: MAX_FILE_BYTES,
      maxFields: 10,
    });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(request, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const assignmentFile = files.assignment?.[0] || files.file?.[0];
    const rubricFile = files.rubric?.[0];
    const pdfMethod = fields.pdfMethod?.[0] || "parser";
    
    if (!assignmentFile) {
      return response.status(400).json({ error: "Assignment file is required." });
    }

    const fileName = decodeURIComponent(String(fields.fileName?.[0] ?? assignmentFile.originalFilename ?? "assignment.txt"));
    const mimeType = String(assignmentFile.mimetype ?? "application/octet-stream");
    const model = localModel();

    // Read assignment file
    const assignmentBuffer = await readFileBuffer(assignmentFile.filepath);
    if (!assignmentBuffer.length) return response.status(400).json({ error: "The assignment file is empty." });

    // --- Text extraction (same as cloud path) ---
    const extractionStarted = performance.now();
    
    let assignmentText;
    if (pdfMethod === "ai" && (fileName.toLowerCase().endsWith('.pdf') || mimeType === 'application/pdf')) {
      // Use AI extraction for PDF (currently same as parser for local)
      assignmentText = await extractTextWithAI(assignmentBuffer, fileName, mimeType);
    } else {
      // Use traditional parser extraction
      assignmentText = await extractAssignmentText(assignmentBuffer, fileName, mimeType);
    }
    
    // Read rubric file if provided
    let rubricText = "";
    if (rubricFile) {
      const rubricBuffer = await readFileBuffer(rubricFile.filepath);
      if (rubricBuffer.length) {
        const rubricFileName = rubricFile.originalFilename ?? "rubric.txt";
        const rubricMimeType = rubricFile.mimetype ?? "application/octet-stream";
        rubricText = await extractAssignmentText(rubricBuffer, rubricFileName, rubricMimeType);
      }
    }
    
    const extractionMs = performance.now() - extractionStarted;

    // --- Local model inference via Ollama OpenAI-compatible API ---
    const modelStarted = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), localTimeoutMs());
    let upstream;
    try {
      // Log the prompt being sent for debugging
      const promptToSend = buildQuestionPrompt(assignmentText, rubricText);
      console.log("Sending prompt to Local model:");
      console.log("System prompt length:", QUESTION_SYSTEM_PROMPT.length);
      console.log("User prompt length:", promptToSend.length);
      
      upstream = await fetch(`${localBaseUrl()}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          format: "json",   // Ollama-specific: constrains output to valid JSON
          temperature: 0.25,
          max_tokens: 1024,
          messages: [
            { role: "system", content: QUESTION_SYSTEM_PROMPT },
            { role: "user", content: promptToSend },
          ],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      const errText = (await upstream.text().catch(() => "")).slice(0, 500) || upstream.statusText;
      if (upstream.status === 404) {
        throw new Error(
          `Ollama returned 404 — the model "${model}" is not pulled. ` +
          `Run: ollama pull ${model}`
        );
      }
      throw new Error(`Local model request failed (${upstream.status}): ${errText}`);
    }

    const payload = await upstream.json();
    const questions = parseQuestions(payload.choices?.[0]?.message?.content);
    const modelMs = performance.now() - modelStarted;

    return response.status(200).json({
      questions,
      model,
      source: "local",
      extractedText: assignmentText, // Add extracted text for preview
      extractionMethod: pdfMethod,   // Add extraction method for preview
      timing: {
        extractionMs: Math.round(extractionMs),
        modelMs: Math.round(modelMs),
        totalMs: Math.round(performance.now() - totalStarted),
      },
      usage: payload.usage ?? null,
    });
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    const isConnect = error?.code === "ECONNREFUSED" || error?.cause?.code === "ECONNREFUSED";
    const message = isAbort
      ? `Local model did not respond within ${Math.round(localTimeoutMs() / 1000)}s. ` +
        "The model may still be loading — try again in a moment."
      : isConnect
        ? "Could not connect to Ollama. Make sure Ollama is running: ollama serve"
        : error instanceof Error ? error.message : String(error);
    return response.status(500).json({ error: message });
  }
}

async function readFileBuffer(filepath) {
  const fs = await import("fs/promises");
  return await fs.readFile(filepath);
}

// New function to extract text using AI model instead of parser
async function extractTextWithAI(buffer, fileName, mimeType) {
  // For local extraction, we'll just use the existing parser
  // but this could be extended to use local AI models in the future
  return await extractAssignmentText(buffer, fileName, mimeType);
}
