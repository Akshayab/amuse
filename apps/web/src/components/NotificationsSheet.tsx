import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, timeAgo } from "../lib/api";
import { Sheet, Empty, Button } from "./ui";

export function NotificationsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => api("/notifications") });
  useEffect(() => {
    if (open) post("/notifications/read").then(() => qc.invalidateQueries({ queryKey: ["notifications"] }));
  }, [open, qc]);
  const list = data?.notifications ?? [];
  return (
    <Sheet open={open} onClose={onClose} title="Notifications">
      {"Notification" in window && Notification.permission === "default" && (
        <div className="m-4 rounded-xl bg-[var(--hover)] p-3 text-sm">
          Get notified when your agent finishes background work.
          <Button size="sm" className="ml-2" onClick={() => Notification.requestPermission()}>
            Turn on
          </Button>
        </div>
      )}
      {list.length === 0 ? (
        <Empty icon="🔔" title="Nothing yet" body="When I finish something in the background or need you, it shows up here." />
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {list.map((n: any) => (
            <div key={n.id} className="px-5 py-3">
              <div className="text-sm font-medium">{n.title}</div>
              <div className="text-sm text-[var(--muted)]">{n.body}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">{timeAgo(n.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
