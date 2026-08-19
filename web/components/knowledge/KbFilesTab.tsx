"use client";

import { useEffect, useMemo, useState } from "react";
import {
  knowledgeBaseFilePath,
  type KnowledgeBaseFile,
} from "@/lib/knowledge-api";
import type { KnowledgeBase } from "@/lib/knowledge-helpers";
import type { TaskState } from "@/hooks/useKnowledgeProgress";
import type { FilePreviewSource } from "@/components/chat/preview/previewerFor";
import { useCollapsiblePanel } from "@/hooks/useCollapsiblePanel";
import KbDocumentList from "./KbDocumentList";
import KbFilePreview from "./KbFilePreview";

interface KbFilesTabProps {
  kb: KnowledgeBase;
  task?: TaskState;
}

/**
 * Master-detail view for the "Files" tab: list of raw documents on the
 * left, inline preview pane on the right. Both the parent KB list (in
 * `/knowledge`) and this file list can be collapsed to icon-only strips
 * to reclaim horizontal space for the actual preview content.
 */
export default function KbFilesTab({ kb, task }: KbFilesTabProps) {
  const [selectedFile, setSelectedFile] = useState<KnowledgeBaseFile | null>(
    null,
  );
  const fileListPanel = useCollapsiblePanel("knowledge-file-list");

  // Bump refreshKey when the active create/upload task settles so newly
  // indexed files appear automatically.
  const taskExecuting = task?.executing === true;
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (!taskExecuting) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRefreshKey((n) => n + 1);
    }
  }, [taskExecuting]);

  const previewSource = useMemo<FilePreviewSource | null>(() => {
    if (!selectedFile) return null;
    const kbRef = kb.id || kb.name;
    const previewPath = selectedFile.preview_path || selectedFile.name;
    return {
      filename: selectedFile.name,
      mimeType: selectedFile.preview_mime || selectedFile.mime_type || undefined,
      url: knowledgeBaseFilePath(kbRef, previewPath),
      downloadUrl: knowledgeBaseFilePath(kbRef, selectedFile.name),
      previewLabel: selectedFile.preview_path
        ? "PDF preview converted from DOCX"
        : undefined,
      size: selectedFile.size,
      id: `${kbRef}/${selectedFile.name}`,
    };
  }, [kb.id, kb.name, selectedFile]);

  return (
    <div className="flex h-full min-h-0">
      <KbDocumentList
        kbName={kb.id || kb.name}
        refreshKey={refreshKey}
        selectedFile={selectedFile?.name ?? null}
        onSelect={setSelectedFile}
        collapsed={fileListPanel.collapsed}
        onToggleCollapsed={fileListPanel.toggle}
      />
      <div className="min-w-0 flex-1">
        <KbFilePreview
          source={previewSource}
          fileListCollapsed={fileListPanel.collapsed}
          onToggleFileList={fileListPanel.toggle}
        />
      </div>
    </div>
  );
}
