import { useEffect, useState } from "react";
import {
  loadTennisFixtures,
  predictTennisMatch,
  type TennisQuota,
} from "@/lib/tennis.functions";
import {
  surfaceLabel,
  tierLabel,
  type PlayerForm,
  type TennisCandidate,
  type TennisFixture,
} from "@/lib/tennis-model";

type TennisResult = {
  picks: TennisCandidate[];
  summary: {
    player1Win: number;
    market: number | null;
    expectedGames: number;
    form1: PlayerForm;
    form2: PlayerForm;
    surfaceH2H: { matches: number; player1Wins: number; player2Wins: number } | null;
    matchesFound: { player1: number; player2: number };
  };
};

type SavedTennis = { fixture: TennisFixture; result: TennisResult; at: string };

const STORE = "marcador-tennis";
const KEEP_DAYS = 7;
const KEEP_MAX = 40;

function readSaved(): SavedTennis[] {
  try {
    const raw = localStorage.getItem(STORE);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const limit = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    return (parsed as SavedTennis[])
      .filter((row) => row && row.fixture && row.result && Date.parse(row.at) >= limit)
      .slice(0, KEEP_MAX);
  } catch {
    return [];
  }
}

function writeSaved(rows: SavedTennis[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(rows));
  } catch {
    // Sin espacio o sin permiso: el pronóstico sigue visible en esta sesión.
  }
}

function quotaText(quota: TennisQuota | null): string {
  if (!quota || quota.remaining === null) return "";
  return quota.limit !== null
    ? `Peticiones restantes: ${quota.remaining} de ${quota.limit}.`
    : `Peticiones restantes: ${quota.remaining}.`;
}

function ResultCard({ fixture, result }: { fixture: TennisFixture; result: TennisResult }) {
  const { summary, picks } = result;
  const p2 = 100 - summary.player1Win;
  const form = (name: string, f: PlayerForm) =>
    `${name}: ${f.recent.wins} de ${f.recent.played} últimos${
      f.surface.played > 0 ? `, ${f.surface.wins} de ${f.surface.played} en ${surfaceLabel(fixture.tournament.surface)}` : ""
    }`;
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-bg p-3">
      <div>
        <div className="flex justify-between text-sm font-semibold">
          <span className="min-w-0 truncate pr-2">{fixture.player1.name} {summary.player1Win}%</span>
          <span className="min-w-0 truncate pl-2 text-right">{p2}% {fixture.player2.name}</span>
        </div>
        <div
          className="mt-2 flex h-3 overflow-hidden rounded-full bg-line"
          role="img"
          aria-label={`${fixture.player1.name} ${summary.player1Win}%, ${fixture.player2.name} ${p2}%`}
        >
          <div className="bg-pitch" style={{ width: `${summary.player1Win}%` }} />
          <div className="bg-away" style={{ width: `${p2}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">
          {form(fixture.player1.name, summary.form1)}. {form(fixture.player2.name, summary.form2)}.
          {summary.market !== null && ` Las cuotas dan a ${fixture.player1.name} un ${summary.market}%.`}
          {summary.surfaceH2H &&
            ` Cara a cara en ${surfaceLabel(fixture.tournament.surface)}: ${summary.surfaceH2H.player1Wins}-${summary.surfaceH2H.player2Wins}.`}
          {` Juegos esperados: ${summary.expectedGames.toLocaleString("es")}.`}
        </p>
        {(summary.matchesFound.player1 < 5 || summary.matchesFound.player2 < 5) && (
          <p className="mt-1 text-xs text-warn">
            Muestra corta: hay pocos partidos recientes de circuito de alguno de los dos jugadores.
          </p>
        )}
      </div>
      {picks.length === 0 ? (
        <p className="border-t border-line pt-3 text-sm text-muted">
          No hay una ventaja estadística clara para recomendar apuesta en este partido.
        </p>
      ) : (
        picks.map((pick, index) => (
          <div key={pick.id} className="border-t border-line pt-3">
            <p className="text-xs font-semibold text-muted">
              {index === 0 ? "Mejor opción" : `Alternativa ${index}`}
            </p>
            <p className="font-semibold">{pick.title}</p>
            <p className="text-pitch">{pick.selection}</p>
            <p className="mt-1 text-sm text-muted">{pick.evidence}</p>
          </div>
        ))
      )}
    </div>
  );
}

export function TennisPanel({ rapidKey, date }: { rapidKey: string; date: string }) {
  const [fixtures, setFixtures] = useState<TennisFixture[]>([]);
  const [saved, setSaved] = useState<SavedTennis[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [quota, setQuota] = useState<TennisQuota | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSaved(readSaved());
  }, []);

  async function onLoad() {
    setError("");
    setNote("");
    setBusy("load");
    try {
      const out = await loadTennisFixtures({ data: { rapidKey: rapidKey.trim(), date } });
      setFixtures(out.fixtures);
      setLoaded(true);
      if (out.quota) setQuota(out.quota);
      setNote(
        out.note ||
          (out.fixtures.length === 0
            ? "No hay partidos de los torneos que sigue la app para esa fecha (el día cuenta en horario UTC)."
            : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el tenis.");
    } finally {
      setBusy(null);
    }
  }

  async function onPredict(fixture: TennisFixture) {
    setError("");
    setBusy(fixture.id);
    try {
      const out = await predictTennisMatch({ data: { rapidKey: rapidKey.trim(), fixture } });
      if (out.quota) setQuota(out.quota);
      const row: SavedTennis = { fixture, result: out, at: new Date().toISOString() };
      setSaved((current) => {
        const next = [row, ...current.filter((r) => r.fixture.id !== fixture.id)].slice(0, KEEP_MAX);
        writeSaved(next);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo pronosticar el partido.");
    } finally {
      setBusy(null);
    }
  }

  const resultFor = (id: string) => saved.find((row) => row.fixture.id === id)?.result;

  return (
    <section aria-labelledby="tennis-title" className="space-y-3 border-t border-line pt-5">
      <div>
        <h3 id="tennis-title" className="font-display text-xl">Tenis</h3>
        <p className="mt-1 text-xs text-muted">
          ATP 250, 500, Masters 1000, Grand Slam, ATP Finals y Copa Davis, más el WTA Finals. Cada pronóstico gasta unas 2 o 3 de las 50 peticiones diarias del plan gratuito de Tennis API.
        </p>
      </div>
      {!rapidKey && (
        <p className="text-sm text-muted">Añade la clave de RapidAPI en APIs para cargar el tenis.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null || !rapidKey}
          onClick={onLoad}
          className="min-h-12 rounded-xl bg-pitch-deep px-4 py-3 font-semibold text-bg disabled:opacity-50"
        >
          {busy === "load" ? "Cargando…" : "Cargar tenis"}
        </button>
        {quotaText(quota) && <p className="text-xs text-muted">{quotaText(quota)}</p>}
      </div>
      {note && <p role="status" className="text-sm text-muted">{note}</p>}
      {error && (
        <p role="alert" className="rounded-xl border border-warn bg-surface px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}
      {loaded && fixtures.length > 0 && (
        <ul className="space-y-3">
          {fixtures.map((f) => {
            const result = resultFor(f.id);
            const kick = f.date
              ? new Date(f.date).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
              : "—";
            return (
              <li key={f.id} className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-xs text-muted">
                  {f.tournament.name} · {tierLabel(f.tour, f.tournament.rankId)} · {surfaceLabel(f.tournament.surface)}
                  {f.roundName ? ` · ${f.roundName}` : ""}
                </p>
                <div className="mt-1 flex items-center gap-3">
                  <span className="w-12 shrink-0 text-sm text-muted">{kick}</span>
                  <span className="min-w-0 flex-1 text-sm font-semibold sm:text-base">
                    {f.player1.name} <span className="font-normal text-muted">vs</span> {f.player2.name}
                  </span>
                  <button
                    type="button"
                    disabled={busy !== null || !rapidKey}
                    onClick={() => onPredict(f)}
                    className="min-h-11 shrink-0 rounded-xl border border-pitch bg-surface px-3 py-2 text-sm font-semibold text-pitch disabled:opacity-50"
                  >
                    {busy === f.id ? "Analizando…" : result ? "Actualizar" : "Pronosticar"}
                  </button>
                </div>
                {result && <ResultCard fixture={f} result={result} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
