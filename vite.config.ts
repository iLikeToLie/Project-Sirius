import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // The deploy workflow sets VITE_BASE from the repository name so renames do not break the site.
  base: loadEnv(mode, '.', 'VITE_').VITE_BASE ?? '/friis-rf-calculator/',
  plugins: [react()],
}));
