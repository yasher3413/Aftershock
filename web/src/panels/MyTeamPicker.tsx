import { useLive } from "../live/store";
import { useMyTeam } from "../lib/myTeam";

export function MyTeamPicker() {
  const teams = useLive((s) => s.teams);
  const { team, setTeam } = useMyTeam();
  const list = Object.values(teams).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-soft">
      My team
      <select
        value={team ?? ""}
        onChange={(e) => setTeam(e.target.value || null)}
        className="rounded-[var(--radius)] border border-ice-scratch bg-surface px-2 py-1 text-ink"
      >
        <option value="">None</option>
        {list.map((t) => (
          <option key={t.abbrev} value={t.abbrev}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
