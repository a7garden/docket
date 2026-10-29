import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RunDot } from "@/components/bits";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api";
import { useJobs } from "@/lib/jobs";
import { useUpdate } from "@/lib/updater";

/** 받기 시작을 알리고, 실패하면 같은 알림을 실패로 바꾼다. Windows 는 다 받으면 설치기가 앱을 꺼서 성공 알림이 없다. */
function startInstall() {
	const { update, install } = useUpdate.getState();
	const id = toast.loading(`${update?.version ?? "새 판"} 받는 중`);
	install().catch((e) => toast.error("업데이트하지 못했습니다", { id, description: String(e) }));
}

/**
 * 업데이트를 설치하기 전에 돌고 있는 Claude 실행을 묻는다. 토스트와 설정의 설치 단추가 모두 여기를 거친다.
 * 설치기가 앱을 끄면 작업 개체가 닫혀 claude 도 함께 꺼진다(runner.rs bind_to_app). 창을 닫는 것과 같은 결과라 같은 꼴로 묻는다.
 * 실행이 없으면 묻지 않고 바로 깐다.
 */
export function UpdateConfirm() {
	const confirming = useUpdate((s) => s.confirming);
	const jobs = useJobs();
	const [ask, setAsk] = useState(false);
	const count = useRef(0);
	count.current = jobs.length;

	// 누른 그 순간의 실행 수로 한 번만 가른다. 창을 띄운 뒤 실행이 끝났다고 저절로 깔면 사용자가 고르기 전에 앱이 꺼진다.
	useEffect(() => {
		if (!confirming) return;
		if (count.current > 0) setAsk(true);
		else {
			useUpdate.setState({ confirming: false });
			startInstall();
		}
	}, [confirming]);

	const close = () => {
		setAsk(false);
		useUpdate.setState({ confirming: false });
	};
	return (
		<AlertDialog open={ask} onOpenChange={(open) => !open && close()}>
			<AlertDialogContent className="pop">
				<AlertDialogHeader>
					<AlertDialogTitle>Claude 작업 {jobs.length}개가 아직 돌고 있습니다</AlertDialogTitle>
					<AlertDialogDescription>
						업데이트를 설치하면 앱이 꺼지면서 모두 멈춥니다. 이미 고친 파일은 남고 변경 탭에 기록돼 있습니다. 다시 켜면 끊긴 작업을 「다시 시도」로 이어 갈 수 있습니다.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-[13px]">
					{jobs.map((j) => (
						<li key={j.key} className="flex items-center gap-2">
							<RunDot className={j.phase === "queued" ? "bg-subtle" : undefined} />
							<span className="min-w-0 flex-1 truncate">{j.label}</span>
							<span className="shrink-0 text-[12px] text-subtle">
								{j.what}
								{j.phase === "queued" && " · 대기"}
							</span>
						</li>
					))}
				</ul>
				<AlertDialogFooter>
					<AlertDialogCancel>나중에</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() =>
							void (async () => {
								close();
								// 멈추라고 알린 뒤 깐다. 미처 못 멈춘 claude 는 설치기가 앱을 끌 때 작업 개체가 끈다.
								await api.runsStopAll().catch(() => 0);
								startInstall();
							})()
						}
					>
						중지하고 설치
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
