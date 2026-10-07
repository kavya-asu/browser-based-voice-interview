import { extractAssignmentText } from "../lib/extract-assignment.js";

const MAX_FILE_BYTES = 3 * 1024 * 1024;

async function readRequestBuffer(request) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === "string") return Buffer.from(request.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_FILE_BYTES) throw new Error("Assignment must be 3 MB or smaller.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed." });
  }

  const totalStarted = performance.now();
  try {
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (contentLength > MAX_FILE_BYTES) {
      return response.status(413).json({ error: "Assignment must be 3 MB or smaller." });
    }

    const fileName = decodeURIComponent(
      String(request.headers["x-file-name"] ?? "assignment.txt"),
    );
    const mimeType = String(
      request.headers["content-type"] ?? "application/octet-stream",
    );

    const fileBuffer = await readRequestBuffer(request);
    if (!fileBuffer.length) {
      return response.status(400).json({ error: "The uploaded file is empty." });
    }

    const extractionStarted = performance.now();
    const text = await extractAssignmentText(fileBuffer, fileName, mimeType);
    const extractionMs = Math.round(performance.now() - extractionStarted);
    const totalMs = Math.round(performance.now() - totalStarted);

    return response.status(200).json({
      text,
      timing: { extractionMs, totalMs },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return response.status(500).json({ error: message });
  }
}
