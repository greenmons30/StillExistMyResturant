import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 局域网可访问：dev 与 preview 均监听所有网卡
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
} as any);
