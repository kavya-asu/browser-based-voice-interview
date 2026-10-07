import * as piper from "@mintplex-labs/piper-tts-web";

let piperSession = null;

function piperWasmPaths() {
  return {
    onnxWasm: new URL(`${import.meta.env.BASE_URL}ort/`, window.location.origin).href,
    piperData: `${piper.WASM_BASE}.data`,
    piperWasm: `${piper.WASM_BASE}.wasm`,
  };
}

async function speakWithPiper({ text, audio, write }) {
  const started = performance.now();
  if (piperSession) {
    write("Using cached Piper session...");
  } else {
    write("Loading Piper runtime and voice model...");
    piperSession = await piper.TtsSession.create({
      voiceId: "en_US-hfc_female-medium",
      wasmPaths: piperWasmPaths(),
      progress: (progress) => {
        const percent = progress.total
          ? ` ${Math.round((progress.loaded * 100) / progress.total)}%`
          : "";
        write(`Piper download${percent}: ${progress.url || "asset"}`);
      },
      logger: (message) => write(message),
    });
  }
  write(`Piper ready in ${((performance.now() - started) / 1000).toFixed(1)}s`);

  const generatedAt = performance.now();
  const wav = await piperSession.predict(text);

  URL.revokeObjectURL(audio.src);
  audio.src = URL.createObjectURL(wav);
  write(`Piper generated in ${((performance.now() - generatedAt) / 1000).toFixed(1)}s`);
  await audio.play();
  write("Piper audio playing");
}

window.piperTtsTest = {
  speak: speakWithPiper,
};
