import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Download, ExternalLink } from "lucide-react";
import { api, put } from "../lib/api";
import { Markdown } from "./Markdown";
import { Sheet, Button } from "./ui";

const Ctx = createContext<{ open: (id: number) => void }>({ open: () => {} });
export const useArtifactViewer = () => useContext(Ctx);

/**
 * Relays window.amuse.setData() / ask() from one generated page to the API. Only messages from that
 * exact iframe are accepted, and the record they update is fixed here, never taken from the message.
 */
export function useIframeBridge(
  frame: RefObject<HTMLIFrameElement | null>,
  target: { kind: "artifact" | "space"; id: number } | null,
  onAsk?: (text: string) => void,
) {
  useEffect(() => {
    if (!target) return;
    const fn = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== "object" || !d.amuse) return;
      if (d.amuse === "setData") void put(target.kind === "space" ? `/spaces/${target.id}/data` : `/artifacts/${target.id}/data`, { data: d.data });
      if (d.amuse === "ask" && onAsk && typeof d.text === "string") onAsk(d.text.slice(0, 2000));
    };
    window.addEventListener("message", fn);
    return () => window.removeEventListener("message", fn);
  }, [frame, target?.kind, target?.id, onAsk]);
}

export function ArtifactViewerProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<number | null>(null);
  const [a, setA] = useState<any>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useIframeBridge(frame, id != null ? { kind: "artifact", id } : null);
  useEffect(() => {
    if (id == null) return setA(null);
    api(`/artifacts/${id}`).then((r) => setA(r.artifact));
  }, [id]);
  const raw = id != null ? `/api/artifacts/${id}/raw` : "";
  return (
    <Ctx.Provider value={{ open: setId }}>
      {children}
      <Sheet open={id != null} onClose={() => setId(null)} wide title={a?.title ?? "Loading…"}>
        {a && (
          <div className="flex h-full flex-col">
            <div className="flex gap-2 border-b border-[var(--line)] px-4 py-2">
              <a href={raw} target="_blank" rel="noreferrer">
                <Button size="sm" variant="soft">
                  <ExternalLink size={14} /> Open in new tab
                </Button>
              </a>
              <a href={raw + "?download=1"} download>
                <Button size="sm" variant="soft">
                  <Download size={14} /> Download
                </Button>
              </a>
            </div>
            <div className="flex-1 overflow-auto" data-testid="artifact-viewer">
              {a.kind === "html" && (
                <iframe ref={frame} title={a.title} src={raw} sandbox="allow-scripts allow-forms" className="h-full min-h-[70vh] w-full bg-white" />
              )}
              {a.kind === "pdf" && <iframe title={a.title} src={raw} className="h-full min-h-[75vh] w-full" />}
              {a.kind === "image" && <img src={raw} alt={a.title} className="mx-auto max-h-[80vh] p-4" />}
              {a.kind === "audio" && (
                <div className="p-6">
                  <audio controls src={raw} className="w-full" />
                  {a.meta?.script && <pre className="mt-4 whitespace-pre-wrap text-sm text-[var(--muted)]">{a.meta.script}</pre>}
                </div>
              )}
              {a.kind === "markdown" && (
                <div className="mx-auto max-w-2xl p-6">
                  <Markdown>{a.content ?? ""}</Markdown>
                </div>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </Ctx.Provider>
  );
}
