import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ortFiles = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];

function localOnnxRuntime() {
  const source = (fileName) =>
    resolve("node_modules", "onnxruntime-web", "dist", fileName);

  return {
    name: "local-onnx-runtime",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const fileName = request.url?.split("?")[0].replace(/^\/ort\//, "");
        if (!fileName || !ortFiles.includes(fileName)) {
          next();
          return;
        }

        response.setHeader(
          "Content-Type",
          fileName.endsWith(".wasm") ? "application/wasm" : "text/javascript",
        );
        response.end(readFileSync(source(fileName)));
      });
    },
    generateBundle() {
      for (const fileName of ortFiles) {
        this.emitFile({
          type: "asset",
          fileName: `ort/${fileName}`,
          source: readFileSync(source(fileName)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [localOnnxRuntime()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        ttsTest: "tts-test.html",
      },
    },
  },
});
