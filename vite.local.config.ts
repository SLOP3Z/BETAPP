import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  define: {
    "import.meta.env.VITE_AUTH_ENABLED": JSON.stringify("false"),
    "import.meta.env.VITE_LOCAL_MODE": JSON.stringify("true"),
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});