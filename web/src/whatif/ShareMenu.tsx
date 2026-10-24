import { useEffect, useRef, useState } from "react";
import { drawScenarioCard, type CardInput } from "./shareCard";

type Status = "idle" | "working" | "copied" | "saved" | "error";

/**
 * Share a What-If scenario: copy its link, share or save an image of it (the
 * phone's share sheet can save it to Photos or send it anywhere), or open a
 * ready-made post on X.
 */
export function ShareMenu({
  card,
  tweet,
}: {
  card: Omit<CardInput, "site">;
  /** Post text without the link; the link is added by X. */
  tweet: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const ref = useRef<HTMLDivElement>(null);
  const url = window.location.href;

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)
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
      label: "Share image",
      hint: "Save to Photos, Messages, Instagram, and more",
      run: async () => {
        setStatus("working");
        const file = await image();
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: "My NHL what-if",
              text: `${tweet} ${url}`,
            });
            setStatus("idle");
          } catch {
            setStatus("idle"); // closed the sheet
          }
          return;
        }
        download(file);
        flash("saved");
      },
    },
    {
      label: "Download image",
      hint: "A 1200 by 675 picture of your picks",
      run: async () => {
        setStatus("working");
        download(await image());
        flash("saved");
      },
    },
    {
      label: "Copy link",
      hint: "Opens these exact picks",
      run: async () => {
        try {
          await navigator.clipboard.writeText(url);
          flash("copied");
        } catch {
          flash("error");
        }
      },
    },
    {
      label: "Post to X",
      hint: "A ready-made post with your biggest swings",
      run: () => {
        const intent = new URL("https://x.com/intent/post");
        intent.searchParams.set("text", tweet);
        intent.searchParams.set("url", url);
        window.open(intent, "_blank", "noopener");
      },
    },
  ];

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
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 rounded-[var(--radius)] border border-ice-scratch bg-surface p-1.5 shadow-[0_8px_28px_rgba(10,20,30,0.18)]"
        >
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
      )}
    </div>
  );
}
