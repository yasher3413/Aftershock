import { useState } from "react";

/**
 * A long list that starts short on phones: items past `limit` are hidden
 * below the md breakpoint until "Show all" is pressed. Wider screens always
 * show everything.
 */
export function usePhoneFold(limit: number) {
  const [open, setOpen] = useState(false);
  return {
    /** Classes for the item at index `i`. */
    item: (i: number) => (!open && i >= limit ? "max-md:hidden" : ""),
    /** The button, when there is more to show. */
    more: (total: number, noun: string) =>
      !open && total > limit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 min-h-[44px] text-[14px] font-semibold text-blue-line md:hidden"
        >
          Show all {total} {noun}
        </button>
      ) : null,
  };
}
