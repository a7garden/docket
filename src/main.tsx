import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUi } from "@/lib/store";
import App from "./App";
import "./index.css";

// 개발 빌드에서만: ?view=claude&issue=<id> 처럼 주소로 첫 화면을 고른다. 화면을 하나씩 띄워 확인할 때 쓴다.
if (import.meta.env.DEV) {
	const q = new URLSearchParams(location.search);
	const ui = useUi.getState();
	const view = q.get("view");
	if (q.get("project")) ui.setProject(q.get("project"));
	if (view === "board" || view === "deliverables" || view === "claude" || view === "settings") ui.setView(view);
	if (q.get("issue")) ui.openIssue(q.get("issue"));
	if (q.get("deliverable")) ui.openDeliverable(q.get("deliverable"));
}

// 데이터는 Rust 사건으로 갱신된다. 창에 다시 들어올 때만 한 번 새로 읽어 바깥(다른 창 · 손 편집)의 변화를 잡는다.
const queryClient = new QueryClient({
	defaultOptions: {
		queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
	},
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<TooltipProvider delayDuration={400}>
				<App />
			</TooltipProvider>
		</QueryClientProvider>
	</React.StrictMode>,
);
