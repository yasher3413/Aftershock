import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useMedia } from "../lib/useMedia";
import { drawScenarioCard, type CardInput } from "./shareCard";

type Status = "idle" | "working" | "copied" | "saved" | "error";

/** Phones can hand an image to other apps. Most desktop browsers cannot, and
 * there a Share image option would only download it. */
function canShareFiles(): boolean {
  try {
    return !!navigator.canShare?.({ files: [new File([""], "card.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

// Short links already made this visit, by scenario.
const saved = new Map<string, Promise<string>>();

/** A short link to these picks (/what-if?id=...), or the full address if
 * the server cannot save them. */
function shortLink(encoded: string): Promise<string> {
  let link = saved.get(encoded);
  if (!link) {
    link = api<{ id: string }>("/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encoded }),
    }).then(
      (r) => `${window.location.origin}/what-if?id=${r.id}`,
      () => {
        saved.delete(encoded);
        return window.location.href;
      },
    );
    saved.set(encoded, link);
  }
  return link;
}

/**
 * Share a What-If scenario: copy its link, share or save an image of it (the
 * phone's share sheet can save it to Photos or send it anywhere), or open a
 * ready-made post on X.
 */
export function ShareMenu({
  card,
  tweet,
  encoded,
}: {
  card: Omit<CardInput, "site">;
  /** Post text without the link; the link is added by X. */
  tweet: string;
  /** The picks, as in the address's `s`. */
  encoded: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const ref = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // On a phone the menu is a sheet along the bottom of the screen; beside a
  // button in the sticky bar it would run off the edge.
  const phone = useMedia("(max-width: 639px)");
  // The link is made when the menu opens, so it is usually ready by the time
  // an option is chosen (browsers allow copying and pop-ups only right after
  // a click).
  const [link, setLink] = useState<{ encoded: string; url: string } | null>(null);
  const url = link?.encoded === encoded ? link.url : null;

  useEffect(() => {
    if (!open) return;
    let live = true;
    void shortLink(encoded).then((u) => live && setLink({ encoded, url: u }));
    return () => {
      live = false;
    };
  }, [open, encoded]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !ref.current?.contains(e.target as Node) &&
            !sheetRef.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const flash = (s: Status) => {
    setStatus(s);
    setTimeout(() => setStatus("idle"), 2000);
  };
  const image = async () =>
    new File(
      [await drawScenarioCard({ ...card, site: window.location.host })],
      "puckquake-what-if.png",
      {
        type: "image/png",
      },
    );
  const download = (file: File) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  const actions: { label: string; hint: string; run: () => Promise<void> | void }[] = [
    {
      label: "Post to X",
      hint: "A ready-made post with your biggest swings",
      run: async () => {
        const intent = (u: string) => {
          const x = new URL("https://x.com/intent/post");
          x.searchParams.set("text", tweet);
          x.searchParams.set("url", u);
          return x.toString();
        };
        if (url) {
          window.open(intent(url), "_blank", "noopener");
          return;
        }
        // Open the tab during the click (later would be blocked), then fill it.
        const tab = window.open("about:blank", "_blank");
        const u = await shortLink(encoded);
        if (tab) {
          tab.opener = null;
          tab.location.href = intent(u);
        } else window.open(intent(u), "_blank", "noopener");
      },
    },
    {
      label: "Copy link",
      hint: "Opens these exact picks",
      run: async () => {
        try {
          if (url) await navigator.clipboard.writeText(url);
          else if (typeof ClipboardItem !== "undefined")
            // Safari keeps the click's permission to copy only this way.
            await navigator.clipboard.write([
              new ClipboardItem({
                "text/plain": shortLink(encoded).then((u) => new Blob([u], { type: "text/plain" })),
              }),
            ]);
          else await navigator.clipboard.writeText(await shortLink(encoded));
          flash("copied");
        } catch {
          flash("error");
        }
      },
    },
    ...(canShareFiles()
      ? [
          {
            label: "Share image",
            hint: "Save to Photos, Messages, Instagram, and more",
            run: async () => {
              setStatus("working");
              const file = await image();
              try {
                await navigator.share({
                  files: [file],
                  title: "My NHL what-if",
                  text: `${tweet} ${url ?? (await shortLink(encoded))}`,
                });
              } catch {
                // closed the sheet
              }
              setStatus("idle");
            },
          },
        ]
      : []),
    {
      label: "Download image",
      hint: "A 1200 by 675 picture of your picks",
      run: async () => {
        setStatus("working");
        download(await image());
        flash("saved");
      },
    },
  ];

  const menu = (
    <div role="menu" aria-label="Share scenario">
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          role="menuitem"
          onClick={async () => {
            setOpen(false);
            try {
              await a.run();
            } catch {
              flash("error");
            }
          }}
          className="flex min-h-[48px] w-full flex-col items-start justify-center rounded-[var(--radius)] px-3 py-1.5 text-left hover:bg-ice-land focus-visible:bg-ice-land"
        >
          <span className="text-[14px] font-semibold">{a.label}</span>
          <span className="text-[12px] text-ink-soft">{a.hint}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius)] border border-ink px-4 text-[13px] font-semibold"
      >
        <svg
          viewBox="0 0 20 20"
          width="16"
          height="16"
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 3v10M6 7l4-4 4 4M4 11v5h12v-5" />
        </svg>
        {status === "copied"
          ? "Link copied"
          : status === "saved"
            ? "Image saved"
            : status === "working"
              ? "Making image"
              : status === "error"
                ? "Could not copy"
                : "Share scenario"}
      </button>
      {open &&
        (phone ? (
          createPortal(
            <>
              <div aria-hidden className="fixed inset-0 z-40 bg-[rgba(10,20,30,0.4)]" />
              <div
                ref={sheetRef}
                className="fixed inset-x-0 bottom-0 z-50 rounded-t-[12px] border-t border-ice-scratch bg-surface px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_28px_rgba(10,20,30,0.25)]"
              >
                <p className="px-3 pt-2 pb-1 text-[13px] font-semibold text-ink-soft">
                  Share scenario
                </p>
                {menu}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-1 min-h-[48px] w-full rounded-[var(--radius)] border border-ice-scratch text-[14px] font-semibold"
                >
                  Cancel
                </button>
              </div>
            </>,
            document.body,
          )
        ) : (
          <div className="absolute right-0 z-30 mt-2 w-72 rounded-[var(--radius)] border border-ice-scratch bg-surface p-1.5 shadow-[0_8px_28px_rgba(10,20,30,0.18)]">
            {menu}
          </div>
        ))}
    </div>
  );
}
