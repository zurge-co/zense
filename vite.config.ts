import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri expects a fixed port in dev
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // Monaco is ~4 MB; give it its own chunk so the main bundle stays lean.
  build: {
    // The monaco chunk is inherently large (full editor, all language services).
    chunkSizeWarningLimit: 5000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "monaco", test: /[\/]node_modules[\/]monaco-editor[\/]/ },
          ],
        },
      },
    },
  },
})
