import { useMemo, useState } from "react";
import { Check, ClipboardCheck, Copy, Loader2, Smartphone } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { TodoItem } from "../../types/electron";

type Props = {
  items: TodoItem[];
  isLoading: boolean;
  copyToClipboard: (text: string) => Promise<void>;
  markActioned: (id: number) => Promise<void>;
};

function formatCreatedAt(value: string) {
  const source = value.endsWith("Z") ? value : `${value}Z`;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-NZ", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TodoPanel({ items, isLoading, copyToClipboard, markActioned }: Props) {
  const [actioningId, setActioningId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => `${item.title || ""} ${item.text}`.toLowerCase().includes(query));
  }, [items, searchQuery]);

  const handleActioned = async (id: number) => {
    if (actioningId !== null) return;
    setActioningId(id);
    try {
      await markActioned(id);
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card/50 dark:bg-card/30 backdrop-blur-sm">
      <div className="border-b border-border/50 p-3">
        <p className="text-[11px] text-muted-foreground">
          Copy a mobile memo, then mark it as actioned when the follow-up is complete.
        </p>
        <Input
          data-testid="todo-search"
          aria-label="Search mobile To Do dictations"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search mobile dictations…"
          className="mt-2 h-8 text-xs"
        />
      </div>

      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 py-8"
        >
          <Loader2 size={14} className="animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted/50 dark:bg-white/4">
            <ClipboardCheck size={18} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">Nothing to action</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Mobile dictations will appear here after EchoDraft processes them.
          </p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">No matching mobile dictations.</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-7 px-2 text-[11px]"
            onClick={() => setSearchQuery("")}
          >
            Clear search
          </Button>
        </div>
      ) : (
        <div className="max-h-[calc(100vh-320px)] min-h-[120px] divide-y divide-border/50 overflow-y-auto">
          {visibleItems.map((item, index) => {
            const itemNumber = index + 1;
            return (
              <article
                key={item.id}
                data-testid="todo-item"
                className="px-3 py-3 transition-colors duration-150 hover:bg-muted/30 dark:hover:bg-white/2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {formatCreatedAt(item.created_at)}
                  </span>
                  <span className="inline-flex items-center rounded-sm bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                    <Smartphone size={10} className="mr-1" />
                    Mobile
                  </span>
                </div>

                {item.title ? (
                  <h3 className="mt-1.5 text-[13px] font-semibold leading-snug text-foreground">
                    {item.title}
                  </h3>
                ) : null}

                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-foreground">
                  {item.text}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void copyToClipboard(item.text)}
                    aria-label={`Copy mobile memo ${itemNumber}`}
                    className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Copy size={12} className="mr-1" />
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleActioned(item.id)}
                    disabled={actioningId !== null}
                    aria-label={`Mark mobile memo ${itemNumber} actioned`}
                    className="h-6 px-2 text-[11px] text-muted-foreground hover:text-success"
                  >
                    {actioningId === item.id ? (
                      <Loader2 size={12} className="mr-1 animate-spin" />
                    ) : (
                      <Check size={12} className="mr-1" />
                    )}
                    Mark actioned
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
