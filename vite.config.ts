import { defineConfig } from "vitest/config";

// O endereço do Pages usa o slug real do repositório. Ajuste se o repositório
// for renomeado ou publicado em um domínio personalizado.
export default defineConfig({
  base: "/Sistema-Cris/",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
  server: {
    host: "0.0.0.0",
  },
});
