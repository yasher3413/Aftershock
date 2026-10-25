import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMedia } from "../lib/useMedia";

type Status = "idle" | "working" | "copied" | "saved" | "error" | "card";
export type ImageUse = "x" | "share";

export interface ShareSpec {
  /** What is shared, for the button and the sheet: "Share scenario". */
  label: string;
  /** Post text without the link; X adds the link. */
  tweet: string;
  /** The page's link; may be made on demand (the What-If Lab saves picks). */
  link: () => Promise<string>;
  /** The card for a post on X (landscape) or for the share sheet. */
  image: (use: ImageUse) => Promise<Blob>;
  /** Identifies this link and card, so each is made once while the menu is open. */
  key: string;
  fileName: string;
  linkHint: string;
  imageHint: string;
}

/** Phones can hand an image to other apps. Most desktop browsers cannot, and
 * there a Share option would only download it. */
function canShareFiles(): boolean {
  try {
    return !!navigator.canShare?.({ files: [new File([""], "card.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

// Links and cards made this visit, newest last; a few are kept.
const made = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = made.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make();
    p.catch(() => made.delete(key));
    made.set(key, p);
    if (made.size > 12) made.delete(made.keys().next().value!);
  }
  return p;
}

/**
 * The share button and its menu, the same everywhere: post on X (with the
 * card copied to paste in), share the card through the phone's share sheet
 * (or download it where a browser cannot share files), and copy the link.
 */
export function ShareMenu({
  spec,
  disabled = false,
  compact = false,
}: {
  spec: ShareSpec;
  /** While what would be shared is still changing. */
  disabled?: boolean;
  /** Icon only; words return while it reports. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const ref = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // On a phone the menu is a sheet along the bottom of the screen.
  const phone = useMedia("(max-width: 639px)");
  const link = () => once(`link:${spec.key}`, spec.link);
  const card = (use: ImageUse) => once(`card:${use}:${spec.key}`, () => spec.image(use));
  // The link and cards are made when the menu opens, so they are usually
  // ready by the time an option is chosen: browsers allow copying and
  // pop-ups only right after a click.
  const [ready, setReady] = useState<{ key: string; url: string } | null>(null);
  const url = ready?.key === spec.key ? ready.url : null;

  useEffect(() => {
    if (!open) return;
    let live = true;
    const key = spec.key;
    void once(`link:${key}`, spec.link).then(
      (u) => live && setReady((r) => (r?.key === key && r.url === u ? r : { key, url: u })),
    );
    for (const use of ["x", "share"] as const)
      void once(`card:${use}:${key}`, () => spec.image(use)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, spec]);

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

  const flash = (s: Status, ms = 2000) => {
    setStatus(s);
    setTimeout(() => setStatus("idle"), ms);
  };
  const file = async (use: ImageUse) =>
    new File([await card(use)], spec.fileName, { type: "image/png" });
  const download = (f: File) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  const actions: { label: string; hint: string; run: () => Promise<void> | void }[] = [
    {
      label: "Post on X",
      hint: "Opens a ready-made post and copies the card: paste it in",
      run: async () => {
        // X's post link cannot attach a picture, so the card goes on the
        // clipboard (started before X opens, while this page has focus) and
        // is pasted into the post. With a picture attached, X shows no link
        // preview.
        const copied =
          typeof ClipboardItem === "undefined"
            ? Promise.resolve(false)
            : navigator.clipboard.write([new ClipboardItem({ "image/png": card("x") })]).then(
                () => true,
                () => false,
              );
        const intent = (u: string) => {
          const x = new URL("https://x.com/intent/post");
          x.searchParams.set("text", spec.tweet);
          x.searchParams.set("url", u);
          return x.toString();
        };
        if (url) window.open(intent(url), "_blank", "noopener");
        else {
          // Open the tab during the click (later would be blocked), then fill it.
          const tab = window.open("about:blank", "_blank");
          const u = await link();
          if (tab) {
            tab.opener = null;
            tab.location.href = intent(u);
          } else window.open(intent(u), "_blank", "noopener");
        }
        // Where the browser will not copy a picture, save it to attach instead.
        const ok = await copied;
        if (!ok) download(await file("x"));
        flash(ok ? "card" : "saved", 8000);
      },
    },
    canShareFiles()
      ? {
          label: "Share",
          hint: "Send the card to Messages, Instagram, Photos, and more",
          run: async () => {
            setStatus("working");
            const f = await file("share");
            try {
              await navigator.share({
                files: [f],
                title: spec.label.replace(/^Share /, ""),
                text: `${spec.tweet} ${url ?? (await link())}`,
              });
            } catch {
              // closed the sheet
            }
            setStatus("idle");
          },
        }
      : {
          label: "Download image",
          hint: spec.imageHint,
          run: async () => {
            setStatus("working");
            download(await file("share"));
            flash("saved");
          },
        },
    {
      label: "Copy link",
      hint: spec.linkHint,
      run: async () => {
        try {
          if (url) await navigator.clipboard.writeText(url);
          else if (typeof ClipboardItem !== "undefined")
            // Safari keeps the click's permission to copy only this way.
            await navigator.clipboard.write([
              new ClipboardItem({
                "text/plain": link().then((u) => new Blob([u], { type: "text/plain" })),
              }),
            ]);
          else await navigator.clipboard.writeText(await link());
          flash("copied");
        } catch {
          flash("error");
        }
      },
    },
  ];

  const label =
    status === "card"
      ? "Card copied"
      : status === "copied"
        ? "Link copied"
        : status === "saved"
          ? "Image saved"
          : status === "working"
            ? "Making image"
            : status === "error"
              ? "Could not share"
              : spec.label;

  const menu = (
    <div role="menu" aria-label={spec.label}>
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
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] border border-ink text-[13px] font-semibold disabled:opacity-50 ${compact && status === "idle" ? "px-0" : "px-4"}`}
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
        {compact && status === "idle" ? <span className="sr-only">{label}</span> : label}
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
                  {spec.label}
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
