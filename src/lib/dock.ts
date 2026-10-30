import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { qk } from "./queries";
import { closingDock, focusInput, soon } from "./regions";
import { useUi } from "./store";
import { GLOBAL_PID, type Issue } from "./types";

/**
 * 옆 칸을 열고 닫는다. Ctrl+J 와 제목 줄 단추가 함께 쓴다. 닫았다 열면 마지막 대화가 다시 뜬다.
 * 띄운 적이 없으면 지금 프로젝트의 가장 최근 대화를, 그것도 없으면 가장 최근 앱 대화를 띄운다. 둘 다 없으면 대화 화면으로 가 고르게 한다.
 */
export function toggleDock(qc: QueryClient) {
	const { dock, setDock, dockTalk, setView, projectId } = useUi.getState();
	if (dock.open && dock.talk) return closingDock(() => setDock({ open: false }));
	// 열면 입력칸으로 간다. 바로 물으려고 여는 칸이다.
	const opened = () => soon(() => focusInput("dock"));
	if (dock.talk) {
		setDock({ open: true });
		return opened();
	}
	for (const pid of [projectId, GLOBAL_PID]) {
		const recent = pid ? qc.getQueryData<Issue[]>(qk.talks(pid))?.[0] : undefined;
		if (recent && pid) {
			dockTalk({ projectId: pid, id: recent.id });
			return opened();
		}
	}
	setView("talks");
	toast("띄울 대화를 고르세요", { description: "대화 머리의 「옆에 띄우기」로 띄웁니다" });
}
