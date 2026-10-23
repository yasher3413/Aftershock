import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * A whole-page message in the page frame: something is missing, or the api
 * did not answer. Same shape as the route error page.
 */
export function PageMessage({
  title,
  children,
  link = { to: "/", label: "Back to tonight" },
  onRetry,
}: {
  title: string;
  children?: ReactNode;
  link?: { to: string; label: string };
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16">
      <h1 className="display text-[38px] font-bold">{title}</h1>
      {children && <p className="mt-3 text-ink-soft">{children}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[44px] rounded-[var(--radius)] bg-ink px-4 text-[14px] font-semibold text-ice"
          >
            Try again
          </button>
        )}
        <Link to={link.to} className="font-semibold text-blue-line underline underline-offset-4">
          {link.label}
        </Link>
      </div>
    </div>
  );
}

/** The message for a page whose request failed for a reason other than 404. */
export function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <PageMessage title="This page could not load" onRetry={onRetry}>
      The Aftershock server did not answer. It usually comes back within a minute.
    </PageMessage>
  );
}
