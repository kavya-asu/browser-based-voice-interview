import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer, loadEnv } from "vite";
import generateQuestions from "./api/generate-questions.js";
import generateQuestionsLocal from "./api/generate-questions-local.js";
import extractText from "./api/extract-text.js";
import listModels from "./api/models.js";

const port = Number(process.env.PORT || 7861);
const localEnv = loadEnv("development", process.cwd(), "");
Object.assign(process.env, localEnv);

function prepareResponse(response) {
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (payload) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(payload));
    return response;
  };
  return response;
}

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
});

const server = createHttpServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname === "/api/models") {
      await listModels(request, prepareResponse(response));
      return;
    }
    if (pathname === "/api/generate-questions") {
      await generateQuestions(request, prepareResponse(response));
      return;
    }
    if (pathname === "/api/generate-questions-local") {
      await generateQuestionsLocal(request, prepareResponse(response));
      return;
    }
    if (pathname === "/api/extract-text") {
      await extractText(request, prepareResponse(response));
      return;
    }
    vite.middlewares(request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      prepareResponse(response).status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      response.end();
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local app: http://127.0.0.1:${port}`);
});
