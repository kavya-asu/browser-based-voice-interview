const API_VERSION_PATH = "/v1";

export function liteLlmUrl(pathname) {
  const configured = (
    process.env.LITELLM_BASE_URL ?? process.env.OPENLLM_BASE_URL
  )?.trim().replace(/\/$/, "");
  if (!configured) throw new Error("LITELLM_BASE_URL is not configured.");
  const normalized = configured.replace(/\/(?:chat\/completions|models)$/i, "");
  const base = normalized.endsWith(API_VERSION_PATH)
    ? normalized
    : `${normalized}${API_VERSION_PATH}`;
  return `${base}${pathname}`;
}

export function liteLlmHeaders() {
  const apiKey = (
    process.env.LITELLM_API_KEY ?? process.env.OPENLLM_API_KEY
  )?.trim();
  if (!apiKey) throw new Error("LITELLM_API_KEY is not configured.");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export function configuredLiteLlmModel() {
  return (process.env.LITELLM_MODEL ?? process.env.OPENLLM_MODEL)?.trim() ?? "";
}

export async function readLiteLlmError(response) {
  const text = await response.text();
  return text.slice(0, 500) || response.statusText;
}
