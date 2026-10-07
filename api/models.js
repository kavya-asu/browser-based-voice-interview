import {
  configuredLiteLlmModel,
  liteLlmHeaders,
  liteLlmUrl,
  readLiteLlmError,
} from "../lib/litellm.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed." });
  }

  try {
    const upstream = await fetch(liteLlmUrl("/models"), {
      headers: liteLlmHeaders(),
    });
    if (!upstream.ok) {
      throw new Error(`LiteLLM models request failed (${upstream.status}): ${await readLiteLlmError(upstream)}`);
    }

    const payload = await upstream.json();
    const models = (payload.data ?? payload.models ?? [])
      .map((model) => typeof model === "string" ? model : model.id ?? model.name)
      .filter(Boolean)
      .sort();
    return response.status(200).json({
      models,
      defaultModel: configuredLiteLlmModel(),
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
