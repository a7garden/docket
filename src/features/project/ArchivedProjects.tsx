import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useArchivedProjects } from "@/lib/queries";
import type { Project } from "@/lib/types";
import { RemoveProject, restoreProject } from "./ProjectHeader";

/** 보관한 프로젝트 목록. 보관 중에는 열어 보지 않으므로 줄을 눌러 여는 동작은 없고, 되살린 뒤 보드에서 본다. */
export function ArchivedProjects({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
	const qc = useQueryClient();
	const { data: projects = [] } = useArchivedProjects();
	const [removing, setRemoving] = useState<Project | null>(null);
	useEffect(() => {
		if (open) setRemoving(null);
	}, [open]);

	const restore = async (p: Project) => {
		await restoreProject(p.id, qc);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="pop max-h-[88vh] gap-4 overflow-y-auto p-6 sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>보관한 프로젝트</DialogTitle>
					<DialogDescription>기록은 그대로 있습니다. 되살리면 다시 열어 볼 수 있습니다.</DialogDescription>
				</DialogHeader>
				{removing ? (
					<RemoveProject project={removing} onCancel={() => setRemoving(null)} onRemoved={() => setRemoving(null)} />
				) : projects.length === 0 ? (
					<p className="text-[13px] text-subtle">보관한 프로젝트가 없습니다.</p>
				) : (
					<ul className="flex flex-col divide-y divide-border">
						{projects.map((p) => (
							<li key={p.id} className="flex items-center gap-2 py-2.5">
								<div className="min-w-0 flex-1">
									<div className="truncate text-[13.5px] font-medium">{p.name}</div>
									<div className="mono truncate text-[12px] text-subtle" title={p.path}>
										{p.path}
									</div>
									<div className="text-[12px] text-subtle">{new Date(p.archivedAt ?? 0).toLocaleDateString("ko-KR")} 보관</div>
								</div>
								<Button size="sm" variant="outline" onClick={() => void restore(p)}>
									<ArchiveRestore />
									되살리기
								</Button>
								<Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => setRemoving(p)}>
									<Unlink />
									목록에서 빼기
								</Button>
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
