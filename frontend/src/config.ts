// Centralizes the backend's location so it's a deployment-time config
// value (Vite env var) instead of hardcoded per-file, with the local-dev
// defaults preserved so `npm run dev` keeps working with no setup.
export const API_HTTP_BASE: string = import.meta.env.VITE_API_HTTP_BASE ?? 'http://localhost:8000'
export const API_WS_BASE: string = import.meta.env.VITE_API_WS_BASE ?? 'ws://localhost:8000'
