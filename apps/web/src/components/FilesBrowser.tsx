import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, ChevronLeft } from "lucide-react";
import { api, put, timeAgo } from "../lib/api";
import { Button, Textarea } from "./ui";

const DESCRIPTIONS: Record<string, string> = {
  "SOUL.md": "Personality, tone and boundaries",
  "IDENTITY.md": "Name, vibe and emoji",
  "USER.md": "What I know about you",
  "MEMORY.md": "Long-term memory",
  "AGENTS.md": "How I work",
  "HEARTBEAT.md": "What I check every 30 minutes",
  "BOOTSTRAP.md": "First-run notes",
};

export function FilesBrowser({ initialPath = null, onBack }: { initialPath?: string | null; onBack?: () => void } = {}) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["files"], queryFn: () => api("/files") });
  const [path, setPath] = useState<string | null>(initialPath);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(false);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    setLoadedPath(null);
    api(`/files?path=${encodeURIComponent(path)}`).then((r) => {
      setContent(r.content ?? "");
      setLoadedPath(path);
    });
  }, [path]);
  if (path)
    return (
      <div className="flex h-full flex-col p-4">
        <button
          onClick={() => (onBack ? onBack() : setPath(null))}
          className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
        >
          <ChevronLeft size={14} /> Back
        </button>
        <div className="mb-2 font-mono text-sm font-semibold">{path}</div>
        {loadedPath !== path ? (
          <div className="text-sm text-[var(--muted)]">Loading…</div>
        ) : (
          <Textarea
            value={content}
            onChange={(e) => (setContent(e.target.value), setSaved(false))}
            className="min-h-[50vh] flex-1 font-mono text-[13px] leading-relaxed"
            data-testid="file-editor"
          />
        )}
        <div className="mt-3 flex items-center gap-3">
          <Button
            size="sm"
            data-testid="file-save"
            onClick={async () => (await put("/files", { path, content }), setSaved(true), qc.invalidateQueries({ queryKey: ["files"] }))}
          >
            Save
          </Button>
          {saved && <span className="text-xs text-[var(--muted)]">Saved</span>}
        </div>
      </div>
    );
  const files = data?.files ?? [];
  const core = files.filter((f: any) => !f.path.includes("/"));
  const other = files.filter((f: any) => f.path.includes("/"));
  return (
    <div className="p-2" data-testid="files-list">
      <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">System files</div>
      {core.map((f: any) => (
        <button
          key={f.path}
          onClick={() => setPath(f.path)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--hover)]"
        >
          <FileText size={16} className="text-[var(--muted)]" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-sm">{f.path}</div>
            <div className="text-xs text-[var(--muted)]">
              {DESCRIPTIONS[f.path] ?? ""} · {timeAgo(f.updatedAt)}
            </div>
          </div>
        </button>
      ))}
      {other.length > 0 && <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Memory, notes & tools</div>}
      {other.map((f: any) => (
        <button key={f.path} onClick={() => setPath(f.path)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-[var(--hover)]">
          <FileText size={14} className="text-[var(--muted)]" />
          <span className="font-mono text-sm">{f.path}</span>
        </button>
      ))}
    </div>
  );
}
