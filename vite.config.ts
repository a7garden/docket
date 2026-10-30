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
	// 데스크톱 앱이라 내려받기는 없지만, 첫 묶음이 클수록 켤 때 풀어 읽는 시간이 는다. 보드 밖 화면은 App.tsx 가 따로 묶는다.
	// 한도는 지금 첫 묶음(약 1.1MB)보다 조금 위다 — 다시 커지면 경고가 뜨게. 기본값 500KB 로 두면 편집기(CodeMirror)가 첫 화면에 있어 늘 뜬다.
	build: { chunkSizeWarningLimit: 1200 },
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
		watch: { ignored: ["**/src-tauri/**"] },
	},
}));
