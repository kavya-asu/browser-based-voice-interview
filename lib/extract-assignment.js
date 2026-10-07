import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import JSZip from "jszip";

const MAX_ASSIGNMENT_CHARS = 50_000;

function decodeXmlText(value) {
  return value.replace(/&#(x[0-9a-f]+|[0-9]+);|&(?:amp|lt|gt|quot|apos);/gi, (entity, numeric) => {
    if (numeric) {
      const codePoint = numeric[0].toLowerCase() === "x"
        ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10);
      return codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint) : "";
    }
    return { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" }[entity.toLowerCase()] ?? entity;
  });
}

async function extractPptxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .map((path) => ({ path, number: /^ppt\/slides\/slide([0-9]+)\.xml$/.exec(path)?.[1] }))
    .filter((slide) => slide.number)
    .sort((a, b) => Number(a.number) - Number(b.number));
  if (!slides.length) throw new Error("No slides were found in the PPTX file.");

  const slideTexts = [];
  for (const { path, number } of slides) {
    const xml = await zip.file(path).async("string");
    // PowerPoint stores visible text in DrawingML <a:t> elements.
    const runs = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXmlText(match[1]));
    if (runs.length) slideTexts.push(`Slide ${number}: ${runs.join(" ")}`);
  }
  return slideTexts.join("\n");
}

export async function extractAssignmentText(buffer, fileName, mimeType = "") {
  const extension = fileName.toLowerCase().split(".").pop();
  let text = "";

  if (extension === "pdf" || mimeType === "application/pdf") {
    const result = await pdfParse(buffer);
    text = result.text;
  } else if (
    extension === "docx" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (
    extension === "pptx" ||
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    text = await extractPptxText(buffer);
  } else if (extension === "txt" || mimeType.startsWith("text/")) {
    text = buffer.toString("utf8");
  } else {
    throw new Error("Unsupported file type. Upload a PDF, DOCX, PPTX, or TXT file.");
  }

  const normalized = text.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("No readable text was found in the assignment.");
  return normalized.slice(0, MAX_ASSIGNMENT_CHARS);
}
