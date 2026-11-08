import { useState } from "react";
import { poissonOverProbability } from "@/lib/football-markets";
import type { MatchAnalysis } from "@/lib/match-analysis";

type Props = {
  fixture: { home: string; away: string; date: string };
  analysis: MatchAnalysis;
};

type TabId = "general" | "goals" | "shots" | "corners" | "cards";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "general", label: "General" },
  { id: "goals", label: "Goles" },
  { id: "shots", label: "Tiros" },
  { id: "corners", label: "Córners" },
  { id: "cards", label: "Tarjetas" },
];

const MISSING_DATA: Record<"shots" | "corners" | "cards", string> = {
  shots: "los tiros de cada equipo",
  corners: "los córners de cada equipo",
  cards: "las tarjetas por equipo y por árbitro",
};

const FORM_STYLE: Record<string, string> = {
  G: "bg-pitch text-bg",
  E: "bg-mid text-bg",
  P: "bg-lose text-bg",
};

function decimal(value: number, digits = 2): string {
  return value.toLocaleString("es", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(value: number): string {
  return `${value.toLocaleString("es", { maximumFractionDigits: 1 })}%`;
}

function barColor(value: number): string {
  if (value >= 70) return "bg-pitch";
  if (value >= 45) return "bg-mid";
  return "bg-away";
}

function FormBadges({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <p className="text-xs text-muted">Sin partidos recientes</p>;
  return (
    <ul className="flex gap-1" aria-label={`Forma reciente: ${tags.join(" ")}`}>
      {tags.map((tag, index) => (
        <li
          key={index}
          className={`grid size-5 place-items-center rounded text-[11px] font-bold ${FORM_STYLE[tag] ?? "bg-line"}`}
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}

function Metric({
  label,
  value,
  fill,
  color,
  average,
}: {
  label: string;
  value: string;
  fill: number;
  color: string;
  average?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-bg p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, fill))}%` }} />
      </div>
      {average && <p className="mt-2 text-xs text-muted">Media liga: {average}</p>}
    </div>
  );
}

function ResultBar({ result }: { result: NonNullable<MatchAnalysis["result"]> }) {
  const segments = [
    { key: "home", label: "Local", value: result.home, color: "bg-pitch" },
    { key: "draw", label: "Empate", value: result.draw, color: "bg-draw" },
    { key: "away", label: "Visitante", value: result.away, color: "bg-away" },
  ];
  return (
    <div>
      <div className="flex justify-between text-sm font-semibold">
        {segments.map((s) => (
          <span key={s.key}>
            {s.label} {s.value}%
          </span>
        ))}
      </div>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-line" role="img"
        aria-label={`Local ${result.home}%, empate ${result.draw}%, visitante ${result.away}%`}>
        {segments.map((s) => (
          <div key={s.key} className={s.color} style={{ width: `${s.value}%` }} />
        ))}
      </div>
    </div>
  );
}

function General({ analysis }: { analysis: MatchAnalysis }) {
  const { result, keyProbabilities: key, expectedGoals: xg, leagueAverages: avg } = analysis;
  if (!result || !key || !xg) {
    return (
      <p className="text-sm text-muted">
        Todavía no hay partidos suficientes de estos equipos para calcular probabilidades fiables.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <ResultBar result={result} />
      <div>
        <h4 className="mb-2 text-sm font-semibold">Probabilidades clave</h4>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Más de 2,5 goles" value={`${key.over25}%`} fill={key.over25} color={barColor(key.over25)} average={avg ? pct(avg.over25) : undefined} />
          <Metric label="Más de 1,5 goles" value={`${key.over15}%`} fill={key.over15} color={barColor(key.over15)} average={avg ? pct(avg.over15) : undefined} />
          <Metric label="Ambos marcan" value={`${key.btts}%`} fill={key.btts} color={barColor(key.btts)} average={avg ? pct(avg.btts) : undefined} />
          <Metric label="Goles esperados" value={decimal(xg.total, 1)} fill={(xg.total / 5) * 100} color="bg-mid" average={avg ? decimal(avg.goals) : undefined} />
        </div>
      </div>
    </div>
  );
}

function Goals({ analysis, home, away }: { analysis: MatchAnalysis; home: string; away: string }) {
  const { expectedGoals: xg, leagueAverages: avg } = analysis;
  return (
    <div className="space-y-4">
      {xg ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Metric label={`Goles esperados · ${home}`} value={decimal(xg.home)} fill={(xg.home / 3) * 100} color="bg-pitch" />
            <Metric label={`Goles esperados · ${away}`} value={decimal(xg.away)} fill={(xg.away / 3) * 100} color="bg-away" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[1.5, 2.5, 3.5].map((line) => {
              const value = Math.round(poissonOverProbability(xg.total, line) * 100);
              return (
                <Metric key={line} label={`Más de ${String(line).replace(".", ",")}`} value={`${value}%`} fill={value} color={barColor(value)}
                  average={avg && line === 1.5 ? pct(avg.over15) : avg && line === 2.5 ? pct(avg.over25) : undefined} />
              );
            })}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">Sin partidos suficientes para estimar los goles esperados.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {([[home, analysis.lastMatches.home, analysis.form.home], [away, analysis.lastMatches.away, analysis.form.away]] as const).map(
          ([team, matches, tags]) => (
            <div key={team}>
              <h4 className="mb-1 text-sm font-semibold">Últimos partidos · {team}</h4>
              <ul className="space-y-1 text-xs text-muted">
                {matches.map((text, index) => (
                  <li key={index} className="flex gap-2">
                    <span className={`grid size-4 shrink-0 place-items-center rounded text-[10px] font-bold ${FORM_STYLE[tags[index]] ?? "bg-line"}`}>
                      {tags[index]}
                    </span>
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export function MatchAnalysisPanel({ fixture, analysis }: Props) {
  const [tab, setTab] = useState<TabId>("general");
  const kickoff = new Date(fixture.date);
  const when = Number.isNaN(kickoff.getTime())
    ? ""
    : kickoff.toLocaleString("es", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface">
      <div className="grid grid-cols-2 gap-3 border-b border-line p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{fixture.home}</p>
          <p className="mb-1 text-xs text-muted">Local</p>
          <FormBadges tags={analysis.form.home} />
        </div>
        <div className="min-w-0 text-right">
          <p className="truncate text-sm font-semibold">{fixture.away}</p>
          <p className="mb-1 text-xs text-muted">Visitante</p>
          <div className="flex justify-end">
            <FormBadges tags={analysis.form.away} />
          </div>
        </div>
        {when && <p className="col-span-2 text-xs text-muted">{when}</p>}
      </div>
      <div role="tablist" aria-label="Análisis del partido" className="flex overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-11 flex-1 whitespace-nowrap px-3 text-sm font-semibold ${
              tab === t.id ? "border-b-2 border-pitch text-pitch" : "text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="p-3">
        {tab === "general" && <General analysis={analysis} />}
        {tab === "goals" && <Goals analysis={analysis} home={fixture.home} away={fixture.away} />}
        {(tab === "shots" || tab === "corners" || tab === "cards") && (
          <p className="text-sm text-muted">
            Aún no tenemos {MISSING_DATA[tab]}: football-data.org no los ofrece. Para mostrarlos hay que conectar otra fuente de datos, como API-Football.
          </p>
        )}
      </div>
    </div>
  );
}
