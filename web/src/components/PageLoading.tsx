/**
 * A full-page wait, set in the page frame. It stays blank for the first
 * 400 ms so a fast load never flashes, then draws a quiet seismograph line.
 */
export function PageLoading({ label }: { label: string }) {
  return (
    <div role="status" className="page-loading mx-auto w-full max-w-6xl px-4 pt-12 md:px-6">
      <svg width="160" height="24" viewBox="0 0 160 24" aria-hidden="true" className="block">
        <path
          className="page-loading-trace"
          d="M0 12 H58 L64 5 L70 20 L76 2 L82 17 L88 12 H160"
          fill="none"
          stroke="var(--ink-soft)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <p className="mt-2 text-[13px] text-ink-soft">{label}</p>
    </div>
  );
}
