import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const toyRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: toyRoot,
  base: "./",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/toy", import.meta.url)),
    emptyOutDir: true,
  },
});
