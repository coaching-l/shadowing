import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  optimizeDeps: {
    exclude: ["kokoro-js", "@breezystack/lamejs"],
    include: ["mammoth", "pdfjs-dist"],
  },
  build: { target: "es2022" },
});
