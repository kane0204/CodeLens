import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    // GitHub Pages is unreliable for many small parallel asset requests.
    // Inline the slide images so each slide needs one module request.
    assetsInlineLimit: 1024 * 1024,
  },
})
