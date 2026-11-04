import { useEffect, useRef, useState, type RefObject } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import type { EditorHandle } from "@/components/MarkdownEditor";
import { api, errorText } from "@/lib/api";
import { attachmentRef, joinPath, newId } from "@/lib/format";
import { useAppInfo, useSettings } from "@/lib/queries";
import type { Issue } from "@/lib/types";

/**
 * 붙이기 전의 메모 하나. 보드 맨 위 작성칸과 빠른 메모 창이 함께 쓴다.
 * 넣은 첨부는 미리 정한 이슈 id 의 폴더로 바로 저장된다. 그래야 메모 본문에 그림 링크를 끼울 수 있다.
 * 프로젝트가 바뀌면 그 폴더도 바뀌어야 하므로, 넣어 둔 첨부를 지우고 새 id 로 다시 시작한다. 글은 남긴다.
 */
export function useDraftIssue(projectId: string | undefined, editor: RefObject<EditorHandle | null>) {
	const { data: settings } = useSettings();
	const { data: info } = useAppInfo();
	const [note, setNote] = useState("");
	const [draftId, setDraftId] = useState(newId);
	const [auto, setAuto] = useState<boolean | null>(null);
	const [model, setModel] = useState("");
	const [effort, setEffort] = useState("");
	const [attachments, setAttachments] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const autoOn = auto ?? settings?.autoPlan ?? true;

	const draftDir = info && projectId ? joinPath(info.dataRoot, "projects", projectId, "issues", draftId) : "";

	const dropRefs = (names: string[]) => setNote((n) => names.reduce((acc, name) => acc.split(attachmentRef(name)).join(""), n).replace(/\n{3,}/g, "\n\n"));

	// 프로젝트를 바꾸면 앞 프로젝트 폴더에 넣어 둔 첨부를 치운다.
	const prev = useRef(projectId);
	useEffect(() => {
		const was = prev.current;
		prev.current = projectId;
		if (was === projectId) return;
		if (was && attachments.length) {
			for (const n of attachments) void api.attachmentDelete(was, draftId, n).catch(() => {});
			dropRefs(attachments);
		}
		setAttachments([]);
		setDraftId(newId());
		// eslint-disable-next-line react-hooks/exhaustive-deps -- 프로젝트가 바뀔 때만 돈다
	}, [projectId]);

	const addFiles = async (paths: string[]) => {
		if (!projectId) return false;
		try {
			const names = await api.attachmentImport(projectId, draftId, paths);
			setAttachments((a) => [...a, ...names]);
			setTimeout(() => names.forEach((n) => editor.current?.insert(attachmentRef(n))), 30);
			return true;
		} catch (e) {
			toast.error(errorText(e));
			return false;
		}
	};

	const pasteImage = async (file: File) => {
		if (!projectId) return null;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const name = await api.attachmentSave(projectId, draftId, bytes, file.type.split("/")[1] ?? "png");
			setAttachments((a) => [...a, name]);
			return attachmentRef(name);
		} catch (e) {
			toast.error(errorText(e));
			return null;
		}
	};

	/** 파일 고르기 창을 띄워 첨부한다. 고르기 창이 떠 있는 동안 창이 초점을 잃는다 — 빠른 창은 그동안 숨지 않아야 한다. */
	const pickFiles = async () => {
		const picked = await openDialog({ multiple: true, title: "첨부할 파일" });
		if (Array.isArray(picked) && picked.length) return addFiles(picked);
		return false;
	};

	const removeAttachment = async (name: string) => {
		if (projectId) await api.attachmentDelete(projectId, draftId, name).catch(() => {});
		setAttachments((a) => a.filter((x) => x !== name));
		dropRefs([name]);
	};

	/** 붙이고 비운다. 붙인 이슈를 돌려주고, 못 붙였으면 null 이다. */
	const submit = async (): Promise<Issue | null> => {
		if (!projectId || !note.trim() || busy) return null;
		setBusy(true);
		try {
			const issue = await api.issueCreate(projectId, draftId, note, autoOn, model, effort);
			setNote("");
			setAttachments([]);
			setDraftId(newId());
			setAuto(null);
			setModel("");
			setEffort("");
			return issue;
		} catch (e) {
			toast.error(errorText(e));
			return null;
		} finally {
			setBusy(false);
		}
	};

	return { settings, note, setNote, draftDir, autoOn, setAuto, model, setModel, effort, setEffort, attachments, busy, addFiles, pasteImage, pickFiles, removeAttachment, submit };
}
