import { extractAssignmentText } from "../lib/extract-assignment.js";
import {
  configuredLiteLlmModel,
  liteLlmHeaders,
  liteLlmUrl,
  readLiteLlmError,
} from "../lib/litellm.js";
import { buildQuestionPrompt, QUESTION_SYSTEM_PROMPT } from "../lib/question-prompt.js";
import formidable from "formidable";

const MAX_FILE_BYTES = 3 * 1024 * 1024;

function parseQuestions(content) {
  const raw = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part.text ?? "").join("")
      : "";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("LiteLLM did not return JSON questions.");
  }
  const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  const questions = parsed.questions?.map((question) => String(question).trim()).filter(Boolean);
  if (!Array.isArray(questions) || questions.length !== 5) {
    throw new Error("LiteLLM must return exactly five questions.");
  }
  return questions;
}

// New function to extract text using AI model instead of parser
async function extractTextWithAI(buffer, fileName, mimeType, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  
  try {
    // For PDF files, use intelligent document processing with proper file handling
    if (fileName.toLowerCase().endsWith('.pdf') || mimeType === 'application/pdf') {
      const systemPrompt = `You are an expert document processor. Your task is to extract ALL readable text content from the provided document. Extract text exactly as it appears, preserving structure and formatting where possible. Return ONLY the extracted text content, nothing else.`;
      
      // Try multiple approaches for better compatibility
      
      // Approach 1: Send as file attachment (proper format for models that support PDF)
      try {
        console.log(`Trying file attachment approach for ${fileName} with model ${model}`);
        const upstream = await fetch(liteLlmUrl("/chat/completions"), {
          method: "POST",
          headers: liteLlmHeaders(),
          signal: controller.signal,
          body: JSON.stringify({
            model,
            temperature: 0.1,
            max_tokens: 2000,
            messages: [
              { role: "system", content: systemPrompt },
              { 
                role: "user", 
                content: [
                  {
                    type: "text",
                    text: "Please extract all readable text from this PDF document:"
                  },
                  {
                    type: "file",
                    file: {
                      file_id: `data:application/pdf;base64,${buffer.toString('base64')}`,
                      format: "application/pdf"
                    }
                  }
                ]
              }
            ],
          }),
        });
        
        if (upstream.ok) {
          const payload = await upstream.json();
          const extractedText = payload.choices?.[0]?.message?.content?.trim() || "";
          // Validate that we got meaningful text extraction
          if (extractedText.length > 100) { // Minimum threshold for reasonable extraction
            console.log(`AI extraction successful with ${extractedText.length} characters extracted`);
            return extractedText;
          } else {
            console.warn("Extracted text too short, trying alternative approach");
          }
        } else {
          const errorText = await upstream.text();
          console.warn("File attachment approach failed:", errorText);
          throw new Error(`HTTP ${upstream.status}: ${errorText}`);
        }
      } catch (approach1Error) {
        console.warn("File attachment approach failed:", approach1Error.message);
      }
      
      // Approach 2: Send base64 encoded document content as text
      try {
        console.log("Trying base64 text approach");
        const upstream = await fetch(liteLlmUrl("/chat/completions"), {
          method: "POST",
          headers: liteLlmHeaders(),
          signal: controller.signal,
          body: JSON.stringify({
            model,
            temperature: 0.1,
            max_tokens: 2000,
            messages: [
              { role: "system", content: systemPrompt },
              { 
                role: "user", 
                content: `Here is a PDF document encoded in base64. Please extract all readable text from it:\n\n${buffer.toString('base64')}\n\nExtract all text content from this PDF document.`
              }
            ],
          }),
        });
        
        if (upstream.ok) {
          const payload = await upstream.json();
          const extractedText = payload.choices?.[0]?.message?.content?.trim() || "";
          // Validate that we got meaningful text extraction
          if (extractedText.length > 50) { // Lower threshold for this approach
            console.log(`AI extraction (base64 approach) successful with ${extractedText.length} characters extracted`);
            return extractedText;
          }
        } else {
          const errorText = await upstream.text();
          console.warn("Base64 approach failed:", errorText);
        }
      } catch (approach2Error) {
        console.warn("Base64 document approach failed:", approach2Error.message);
      }
      
      // If AI approaches fail, gracefully fall back to traditional parser
      console.log("AI extraction attempts failed, falling back to PDF parser");
      return await extractAssignmentText(buffer, fileName, mimeType);
    } else {
      // For non-PDF files, use existing extraction
      return await extractAssignmentText(buffer, fileName, mimeType);
    }
  } finally {
    clearTimeout(timeout);
  }
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
    const requestedModel = decodeURIComponent(String(fields.model?.[0] ?? "")).trim();
    const model = requestedModel || configuredLiteLlmModel();
    if (!model) throw new Error("Choose a model or configure LITELLM_MODEL.");

    // Read assignment file
    const assignmentBuffer = await readFileBuffer(assignmentFile.filepath);
    if (!assignmentBuffer.length) return response.status(400).json({ error: "The assignment file is empty." });

    const extractionStarted = performance.now();
    
    let assignmentText;
    if (pdfMethod === "ai" && (fileName.toLowerCase().endsWith('.pdf') || mimeType === 'application/pdf')) {
      // Use AI extraction for PDF
      assignmentText = await extractTextWithAI(assignmentBuffer, fileName, mimeType, model);
    } else {
      // Use traditional parser extraction
      assignmentText = await extractAssignmentText(assignmentBuffer, fileName, mimeType);
    }
    
    // Read rubric file if provided (always use parser for rubrics)
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

    const modelStarted = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let upstream;
    try {
      // Log the prompt being sent for debugging
      const promptToSend = buildQuestionPrompt(assignmentText, rubricText);
      console.log("Sending prompt to LiteLLM:");
      console.log("System prompt length:", QUESTION_SYSTEM_PROMPT.length);
      console.log("User prompt length:", promptToSend.length);
      
      upstream = await fetch(liteLlmUrl("/chat/completions"), {
        method: "POST",
        headers: liteLlmHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.25,
          max_tokens: 500,
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
      throw new Error(`LiteLLM question request failed (${upstream.status}): ${await readLiteLlmError(upstream)}`);
    }

    const payload = await upstream.json();
    const questions = parseQuestions(payload.choices?.[0]?.message?.content);
    const modelMs = performance.now() - modelStarted;
    return response.status(200).json({
      questions,
      model,
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
    const message = error?.name === "AbortError"
      ? "LiteLLM did not respond within 60 seconds."
      : error instanceof Error ? error.message : String(error);
    
    // More user-friendly error message for AI extraction failures
    if (message.includes("AI extraction failed") || message.includes("BadRequestError") || 
        message.includes("Unsupported image format") || message.includes("image format")) {
      return response.status(500).json({ 
        error: "AI PDF extraction failed. Your model may not fully support PDF files. Please ensure you're using a model that explicitly supports PDF processing (like gemini-3.1-flash-lite) or switch to 'PDF Parser' method for reliable PDF text extraction." 
      });
    }
    
    return response.status(500).json({ error: message });
  }
}

async function readFileBuffer(filepath) {
  const fs = await import("fs/promises");
  return await fs.readFile(filepath);
}
