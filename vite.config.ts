import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // The deploy workflow sets VITE_BASE from the repository name so renames do not break the site.
  base: loadEnv(mode, '.', 'VITE_').VITE_BASE ?? '/friis-rf-calculator/',
  plugins: [react()],
  build: {
    // Libraries get their own chunks so a release that only changes app code keeps them cached.
    // MapLibre alone is about 800 kB and only loads with the Link workspace.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[\\/]maplibre-gl[\\/]/.test(id)) return 'maplibre';
          if (/node_modules[\\/](chart\.js|react-chartjs-2)[\\/]/.test(id)) return 'charts';
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
}));
