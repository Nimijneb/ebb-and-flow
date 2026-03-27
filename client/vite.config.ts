import { rmSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => {
  // Tailwind/Vite can retain resolved asset paths in `node_modules/.vite` after files
  // are deleted (e.g. removed SVGs), causing ENOENT during CSS analysis. Clear dev cache
  // on each dev server start so the graph matches the filesystem.
  if (command === "serve") {
    try {
      rmSync(path.join(__dirname, "node_modules", ".vite"), {
        recursive: true,
        force: true,
      });
    } catch {
      /* ignore missing cache */
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:4000",
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
