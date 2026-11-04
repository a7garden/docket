/**
 * DB 자료 창. 산출물의 DB 트리거가 따를 DB 구조를 앱이 어떻게 받을지 정한다.
 *
 * 앱이 적은 명령을 직접 돌려 표준 출력(탭으로 나눈 행)을 받고, 지난번과 견준 변경을 스냅숏으로 남긴다.
 * 명령은 Claude 에 넘기지 않는다 — 접속 정보가 프롬프트 · 실행 기록에 남지 않게.
 *
 * 목차
 * 1. 견본 — PostgreSQL 구조 조회(information_schema · pg_description)
 * 2. DbSourcesDialog — 목록 편집 · 저장 · 지금 받기 · 스냅숏 이력과 비교
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Database, Download, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Chip, Label } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText } from "@/lib/api";
import { relTime } from "@/lib/format";
import { qk, useDbSources } from "@/lib/queries";
import type { DbSource, DbSourceView, Project, SnapMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ---------- 1. 견본 ---------- */

/**
 * PostgreSQL 컬럼 구조를 탭으로 나눈 행으로 낸다. concat_ws 는 NULL 칸을 건너뛰어 칸이 밀리므로 빌 수 있는 칸은 모두 coalesce 로 채운다.
 * 설명의 줄바꿈 · 탭은 공백 하나로 바꾼다. 비밀번호는 명령에 적지 않고 pgpass.conf 에 둔다.
 */
const PG_SQL = [
	"SELECT concat_ws(E'\\t', c.table_schema, c.table_name, c.column_name, c.ordinal_position, c.data_type,",
	" coalesce(coalesce(c.character_maximum_length, c.numeric_precision)::text, ''), c.is_nullable, coalesce(c.column_default, ''),",
	" coalesce(regexp_replace(col_description(pc.oid, c.ordinal_position), '\\s+', ' ', 'g'), ''),",
	" coalesce(regexp_replace(obj_description(pc.oid, 'pg_class'), '\\s+', ' ', 'g'), ''))",
	" FROM information_schema.columns c",
	" JOIN pg_catalog.pg_namespace pn ON pn.nspname = c.table_schema",
	" JOIN pg_catalog.pg_class pc ON pc.relname = c.table_name AND pc.relnamespace = pn.oid",
	" WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1",
].join("");

const PG_SAMPLE: DbSource = {
	id: "",
	name: "운영 DB 구조",
	command: `psql -X -q -A -t -h localhost -p 5432 -U reader -d mydb -c "${PG_SQL}"`,
	cwd: "",
	columns: ["스키마", "테이블", "컬럼", "순서", "타입", "길이", "NULL 허용", "기본값", "컬럼 설명", "테이블 설명"],
	keyCols: 3,
	timeoutSec: 60,
};

const BLANK: DbSource = { id: "", name: "", command: "", cwd: "", columns: [], keyCols: 3, timeoutSec: 60 };

const plain = (s: DbSourceView | DbSource): DbSource => ({
	id: s.id,
	name: s.name,
	command: s.command,
	cwd: s.cwd,
	columns: [...s.columns],
	keyCols: s.keyCols,
	timeoutSec: s.timeoutSec,
});

const same = (a: DbSource, b: DbSource) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));

/* ---------- 2. 창 ---------- */

export function DbSourcesDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
	const qc = useQueryClient();
	const { data: views = [] } = useDbSources(open ? project.id : null);
	const [list, setList] = useState<DbSource[]>([]);
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		if (open) setList(views.map(plain));
		// 창을 열 때와 저장한 뒤에만 맞춘다. 받는 중에 목록이 다시 와도 쓰던 칸을 덮지 않게 id 묶음만 본다.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, views.map((v) => v.id).join(",")]);

	const dirty = list.length !== views.length || list.some((s, i) => !views[i] || !same(s, views[i]));
	const patch = (i: number, p: Partial<DbSource>) => setList((l) => l.map((s, k) => (k === i ? { ...s, ...p } : s)));

	const save = async () => {
		setSaving(true);
		try {
			const out = await api.dbSourcesSave(project.id, list);
			qc.setQueryData(qk.dbSources(project.id), out);
			setList(out.map(plain));
			await qc.invalidateQueries({ queryKey: qk.projects });
			toast("DB 자료를 저장했습니다");
		} catch (e) {
			toast.error(errorText(e));
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="pop max-h-[88vh] gap-5 overflow-y-auto p-6 sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>DB 자료</DialogTitle>
					<DialogDescription className="text-[12.5px] leading-relaxed break-keep">
						앱이 아래 명령을 돌려 DB 구조를 받고, 지난번과 달라졌으면 그 DB 를 트리거로 고른 산출물에 반영할지 가립니다. 명령과 접속 정보는 Claude 에 보내지 않습니다 — Claude 는 받아 둔 구조
						파일과 바뀐 것 요약만 읽습니다. 앱을 켤 때 · 이슈를 완료할 때 · 「지금 받기」를 누를 때 받습니다.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={() => setList((l) => [...l, { ...PG_SAMPLE, name: l.length ? `${PG_SAMPLE.name} ${l.length + 1}` : PG_SAMPLE.name }])}>
						<Database />
						PostgreSQL 견본 넣기
					</Button>
					<Button variant="ghost" size="sm" onClick={() => setList((l) => [...l, { ...BLANK }])}>
						<Plus />빈 자료
					</Button>
				</div>

				{list.length === 0 ? (
					<p className="text-[13px] leading-relaxed break-keep text-subtle">
						DB 자료가 없습니다. 견본을 넣고 접속 정보(-h · -p · -U · -d)만 고치면 됩니다. 비밀번호는 명령에 적지 말고 <span className="mono">%APPDATA%\postgresql\pgpass.conf</span> 에
						두세요. 읽기 전용 계정을 권합니다.
					</p>
				) : (
					list.map((s, i) => (
						<SourceCard
							key={s.id || `new-${i}`}
							project={project}
							s={s}
							view={views.find((v) => v.id === s.id)}
							saved={!!s.id && !!views.find((v) => v.id === s.id && same(v, s))}
							onChange={(p) => patch(i, p)}
							onRemove={() => setList((l) => l.filter((_, k) => k !== i))}
						/>
					))
				)}

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						닫기
					</Button>
					<Button disabled={!dirty || saving} onClick={() => void save()}>
						{saving && <Loader2 className="animate-spin" />}
						저장
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SourceCard({
	project,
	s,
	view,
	saved,
	onChange,
	onRemove,
}: {
	project: Project;
	s: DbSource;
	view: DbSourceView | undefined;
	saved: boolean;
	onChange: (p: Partial<DbSource>) => void;
	onRemove: () => void;
}) {
	const qc = useQueryClient();
	const [fetching, setFetching] = useState(false);
	const [history, setHistory] = useState(false);
	const busy = fetching || !!view?.busy;

	const fetchNow = async () => {
		setFetching(true);
		try {
			const r = await api.dbSourceFetch(project.id, s.id);
			toast(r.changed ? `「${s.name}」 구조가 바뀌었습니다 · ${r.summary}` : r.first ? `「${s.name}」을 처음 받았습니다 · ${r.rows}행` : `「${s.name}」 바뀐 것 없음 · ${r.rows}행`, {
				description: r.changed && view?.usedBy.length ? `${view.usedBy.join(", ")}에 반영할지 가립니다` : undefined,
			});
		} catch (e) {
			toast.error(errorText(e));
		} finally {
			setFetching(false);
			void qc.invalidateQueries({ queryKey: qk.dbSources(project.id) });
		}
	};

	const last = view?.snapshots[0];
	return (
		<section className="surface flex flex-col gap-3 rounded-md p-4">
			<div className="flex items-center gap-2">
				<Input value={s.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="자료 이름 (예: 운영 DB 구조)" className="h-8 flex-1 text-[13px] font-medium md:text-[13px]" />
				<Button
					variant="outline"
					size="sm"
					disabled={!saved || busy}
					title={saved ? "명령을 돌려 지금 구조를 받습니다" : "먼저 저장하세요"}
					onClick={() => void fetchNow()}
				>
					{busy ? <Loader2 className="animate-spin" /> : <Download />}
					지금 받기
				</Button>
				<Button variant="ghost" size="icon" aria-label="자료 지우기" title="목록에서 뺍니다. 받아 둔 스냅숏은 남습니다." onClick={onRemove}>
					<Trash2 />
				</Button>
			</div>

			{view && (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-subtle">
					{view.error ? <span className="text-danger">{view.error}</span> : view.checkedAt ? <span>{relTime(view.checkedAt)} 받음</span> : <span>아직 받지 않음</span>}
					{last && <span>{last.rows.toLocaleString()}행 · 스냅숏 {view.snapshots.length}</span>}
					{view.usedBy.length > 0 ? <span>트리거: {view.usedBy.join(", ")}</span> : <span>트리거로 고른 산출물 없음</span>}
				</div>
			)}

			<div className="flex flex-col gap-1.5">
				<Label>조회 명령</Label>
				<Textarea
					value={s.command}
					onChange={(e) => onChange({ command: e.target.value })}
					spellCheck={false}
					rows={4}
					placeholder="탭으로 나눈 행을 표준 출력으로 내는 명령 (cmd 로 돕니다)"
					className="mono min-h-20 text-[12px] leading-relaxed md:text-[12px]"
				/>
			</div>
			<div className="grid grid-cols-[minmax(0,1fr)_88px_88px] gap-3">
				<div className="flex flex-col gap-1.5">
					<Label>칸 이름 (쉼표로 나눔)</Label>
					<Input
						value={s.columns.join(", ")}
						onChange={(e) => onChange({ columns: e.target.value.split(",").map((c) => c.trimStart()) })}
						placeholder="비우면 칸 1, 칸 2 …"
						className="h-8 text-[12.5px] md:text-[12.5px]"
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>열쇠 칸 수</Label>
					<Input type="number" min={1} max={20} value={s.keyCols} onChange={(e) => onChange({ keyCols: Number(e.target.value) || 1 })} className="tabular h-8 text-[13px]" />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>제한(초)</Label>
					<Input type="number" min={5} max={600} value={s.timeoutSec} onChange={(e) => onChange({ timeoutSec: Number(e.target.value) || 60 })} className="tabular h-8 text-[13px]" />
				</div>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label>실행 폴더</Label>
				<Input value={s.cwd} onChange={(e) => onChange({ cwd: e.target.value })} placeholder={`비우면 프로젝트 폴더 (${project.path})`} className="mono h-8 text-[12px] placeholder:font-sans md:text-[12px]" />
				<p className="text-[12px] leading-relaxed break-keep text-subtle">
					앞에서부터 「열쇠 칸 수」만큼이 한 행을 가리키는 열쇠입니다(스키마 · 테이블 · 컬럼이면 3). 같은 열쇠의 다른 칸이 달라지면 「바뀜」, 열쇠가 새로 생기거나 사라지면 「추가」 · 「삭제」로 셉니다.
				</p>
			</div>

			{view && view.snapshots.length > 0 && (
				<div className="flex flex-col gap-1.5">
					<button type="button" className="flex items-center gap-1 self-start text-[12.5px] text-muted-foreground hover:text-foreground" onClick={() => setHistory((h) => !h)}>
						{history ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
						받은 구조 {view.snapshots.length}
					</button>
					{history && <History project={project} view={view} />}
				</div>
			)}
		</section>
	);
}

/** 스냅숏 이력. 앞 스냅숏과의 비교를 펼쳐 본다. */
function History({ project, view }: { project: Project; view: DbSourceView }) {
	const [openId, setOpenId] = useState("");
	const [text, setText] = useState("");
	const compare = async (snap: SnapMeta, prev: SnapMeta | undefined) => {
		if (openId === snap.id || !prev) {
			setOpenId("");
			return;
		}
		setOpenId(snap.id);
		setText("");
		try {
			setText(await api.dbSnapshotCompare(project.id, view.id, prev.id, snap.id));
		} catch (e) {
			setText(errorText(e));
		}
	};
	return (
		<ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
			{view.snapshots.map((snap, i) => {
				const prev = view.snapshots[i + 1];
				const first = !prev;
				return (
					<li key={snap.id} className="text-[12.5px]">
						<button
							type="button"
							disabled={first}
							onClick={() => void compare(snap, prev)}
							className={cn("flex h-9 w-full items-center gap-3 px-3 text-left", !first && "hover:bg-hover")}
						>
							<span className="w-24 shrink-0 text-subtle">{relTime(snap.at)}</span>
							<span className="tabular w-16 shrink-0 text-muted-foreground">{snap.rows.toLocaleString()}행</span>
							{first ? (
								<Chip>처음 받음</Chip>
							) : (
								<span className="flex items-center gap-1.5">
									{snap.added > 0 && <Chip tone="ok">추가 {snap.added}</Chip>}
									{snap.removed > 0 && <Chip tone="danger">삭제 {snap.removed}</Chip>}
									{snap.changed > 0 && <Chip tone="brand">바뀜 {snap.changed}</Chip>}
								</span>
							)}
							<span className="flex-1" />
							{!first && <span className="text-subtle">{openId === snap.id ? "접기" : "비교"}</span>}
						</button>
						{openId === snap.id && (
							<pre className="mono max-h-72 overflow-auto border-t border-border bg-muted/40 px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap">{text || "읽는 중…"}</pre>
						)}
					</li>
				);
			})}
		</ul>
	);
}
