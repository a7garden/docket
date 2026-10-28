import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: { "@": path.resolve(__dirname, "./src") },
	},
	// Tauri 가 고정 포트를 기다리므로 포트가 차 있으면 다른 포트로 넘어가지 않고 실패해야 한다.
	clearScreen: false,
	// 데스크톱 앱이라 첫 화면 내려받기 크기를 아낄 까닭이 적다.
	build: { chunkSizeWarningLimit: 2500 },
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
		watch: { ignored: ["**/src-tauri/**"] },
	},
}));
