import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { bytes, relTime } from "@/lib/format";
import { useUpdate } from "@/lib/updater";
import { Group, Row } from "./Settings";
// 깔린 판의 바뀐 내용은 앱에 묶어 둔다. 오프라인이어도 보이고, 릴리즈 노트와 같은 원본(CHANGELOG.md)이다.
import changelog from "../../../CHANGELOG.md?raw";

/** 첫 판 구획부터 보인다. 맨 위 제목과 쓰는 법 안내는 이 파일을 고치는 사람에게 하는 말이다. */
const CHANGELOG = changelog.slice(Math.max(0, changelog.search(/^## /m)));

/** 설정 › 업데이트. 지금 판 · 새 판 확인과 설치 · 판마다 바뀐 내용. */
export function Updates({ version }: { version?: string }) {
	const { phase, update, progress, error, checkedAt, check, install } = useUpdate();
	const [all, setAll] = useState(false);
	const busy = phase === "checking" || phase === "downloading";

	const status =
		phase === "checking"
			? "확인하는 중…"
			: phase === "latest"
				? "최신 판입니다."
				: phase === "available" && update
					? `새 판 ${update.version} 이 있습니다.`
					: phase === "downloading"
						? progress.total
							? `받는 중 ${bytes(progress.done)} / ${bytes(progress.total)}`
							: `받는 중 ${bytes(progress.done)}`
						: phase === "error"
							? `확인하지 못했습니다 · ${error}`
							: "아직 확인하지 않았습니다.";

	return (
		<Group title="업데이트">
			<Row label={`지금 판 ${version ?? ""}`} hint={checkedAt ? `${status} · ${relTime(checkedAt)} 확인` : status} inline>
				<Button variant="outline" size="sm" disabled={busy} onClick={() => void check().catch(() => {})}>
					<RefreshCw className={phase === "checking" ? "animate-spin" : undefined} />
					업데이트 확인
				</Button>
			</Row>
			{update && (phase === "available" || phase === "downloading" || phase === "error") && (
				<Row label={`${update.version} 에서 바뀐 것`} hint="설치하면 앱이 꺼졌다 다시 켜집니다. 돌던 Claude 실행은 멈춥니다.">
					{update.body ? <Markdown text={update.body} className="text-[13px]" /> : <p className="text-[12.5px] text-subtle">릴리즈에 적힌 내용이 없습니다.</p>}
					<div>
						<Button size="sm" disabled={phase === "downloading"} onClick={() => void install().catch((e) => toast.error("업데이트하지 못했습니다", { description: String(e) }))}>
							<Download />
							설치하고 다시 켜기
						</Button>
					</div>
				</Row>
			)}
			<Row label="바뀐 내용" hint="깔린 판까지의 기록입니다.">
				<div className={all ? undefined : "max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]"}>
					<Markdown text={CHANGELOG} className="text-[13px] selectable" />
				</div>
				<div>
					<Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
						{all ? "접기" : "모두 보기"}
					</Button>
				</div>
			</Row>
		</Group>
	);
}
