import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CircleDot, History, KeyRound, ListChecks, Wallet } from "lucide-react";
import { BetsPanel } from "@/components/bets-panel";
import { loadFixtures, predictFixture, type Prediction } from "@/lib/football.functions";

export const Route = createFileRoute("/")({ component: Home });

type Fixture = Awaited<ReturnType<typeof loadFixtures>>["fixtures"][number];

type SavedPick = {
  fixture: Fixture;
  prediction: Prediction;
  at: string;
};

const KEYS = "marcador-keys";
const CACHE = "marcador-picks";

function readStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isSavedPick(value: unknown): value is SavedPick {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const fixture = row.fixture;
  const prediction = row.prediction;
  if (typeof fixture !== "object" || fixture === null || typeof prediction !== "object" || prediction === null) {
    return false;
  }
  const match = fixture as Record<string, unknown>;
  const pick = prediction as Record<string, unknown>;
  const probs = pick.probs;
  return (
    typeof match.id === "number" &&
    typeof match.home === "string" &&
    typeof match.away === "string" &&
    typeof match.league === "string" &&
    (pick.pick === "1" || pick.pick === "X" || pick.pick === "2") &&
    typeof pick.confidence === "number" &&
    typeof pick.over25 === "number" &&
    typeof pick.btts === "number" &&
    typeof pick.reason === "string" &&
    typeof probs === "object" &&
    probs !== null &&
    typeof (probs as Record<string, unknown>).home === "number" &&
    typeof (probs as Record<string, unknown>).draw === "number" &&
    typeof (probs as Record<string, unknown>).away === "number"
  );
}

function Home() {
  const [footballKey, setFootballKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [fdKey, setFdKey] = useState("");
  const [model, setModel] = useState("gemini-3.5-flash-lite");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [busy, setBusy] = useState<"load" | "predict" | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<SavedPick[]>([]);
  const [tab, setTab] = useState<"keys" | "matches" | "history" | "bets">("matches");

  useEffect(() => {
    const parsed = readStored<{ footballKey?: string; geminiKey?: string; fdKey?: string; model?: string }>(KEYS);
    if (parsed) {
      setFootballKey(typeof parsed.footballKey === "string" ? parsed.footballKey : "");
      setGeminiKey(typeof parsed.geminiKey === "string" ? parsed.geminiKey : "");
      setFdKey(typeof parsed.fdKey === "string" ? parsed.fdKey : "");
      if (typeof parsed.model === "string" && parsed.model.trim()) {
        setModel(
          parsed.model === "gemini-2.5-flash-lite" ? "gemini-3.5-flash-lite" : parsed.model,
        );
      }
    }
    const picks = readStored<unknown>(CACHE);
    if (Array.isArray(picks)) setResults(picks.filter(isSavedPick));
  }, []);

  function saveKeys() {
    if (writeStored(KEYS, { footballKey, geminiKey, fdKey, model })) {
      setError("");
      setSaveFeedback({
        message: "Claves guardadas. Se enviarán a sus proveedores cuando hagas consultas.",
        isError: false,
      });
    } else {
      setSaveFeedback({ message: "El navegador no permitió guardar las claves.", isError: true });
    }
  }

  async function onLoad() {
    setError("");
    setBusy("load");
    setNote("");
    try {
      const data = await loadFixtures({ data: { apiKey: footballKey.trim(), date } });
      setFixtures(data.fixtures);
      setPicked([]);
      setNote(
        data.fixtures.length
          ? `${data.fixtures.length} partidos de las competiciones seguidas (${data.scanned} encuentros consultados hoy). 1 llamada.`
          : `Ningún partido de las competiciones seguidas. Se miraron ${data.scanned} encuentros. 1 llamada.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la jornada.");
    } finally {
      setBusy(null);
    }
  }

  async function onPredict() {
    setError("");
    if (picked.length === 0) {
      setError("Elige al menos un partido. Máximo 5 para no gastar la cuota.");
      return;
    }
    setBusy("predict");
    const next = [...results];
    const failedIds: number[] = [];
    const failures: string[] = [];
    let successful = 0;
    let storageFailed = false;
    try {
      for (const id of picked) {
        const fixture = fixtures.find((f) => f.id === id);
        if (!fixture) continue;
        setNote(`Analizando ${fixture.home} – ${fixture.away}…`);
        try {
          const out = await predictFixture({
            data: {
              apiKey: footballKey.trim(),
              geminiKey: geminiKey.trim(),
              fdKey: fdKey.trim(),
              model: model.trim(),
              fixture,
            },
          });
          const row: SavedPick = {
            fixture,
            prediction: out.prediction,
            at: new Date().toISOString(),
          };
          const idx = next.findIndex((r) => r.fixture.id === id);
          if (idx >= 0) next[idx] = row;
          else next.unshift(row);
          setResults([...next]);
          storageFailed = !writeStored(CACHE, next) || storageFailed;
          successful += 1;
        } catch (err) {
          failedIds.push(id);
          const message = err instanceof Error ? err.message : "Falló el pronóstico.";
          failures.push(`${fixture.home} vs ${fixture.away}: ${message}`);
        }
      }
      setError(failures.length ? `No se pudieron analizar: ${failures.join(" · ")}` : "");
      setNote(failures.length
        ? `${successful} partido(s) listos. Los fallidos siguen seleccionados para reintentar.`
        : storageFailed
          ? "Pronóstico listo, pero el navegador no permitió guardar el historial."
          : "Listo. Los mercados se estiman con la forma actual de los equipos.");
      setPicked(failedIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falló el pronóstico.");
      setNote("");
      writeStored(CACHE, next);
    } finally {
      setBusy(null);
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, Fixture[]>();
    for (const f of fixtures) {
      const key = `${f.country} · ${f.league}`;
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return [...map.entries()];
  }, [fixtures]);

  const tabs = [
    { id: "keys" as const, label: "APIs", Icon: KeyRound },
    { id: "matches" as const, label: "Partidos", Icon: ListChecks },
    { id: "history" as const, label: "Historial", Icon: History },
    { id: "bets" as const, label: "Apuestas", Icon: Wallet },
  ];

  function toggle(id: number) {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 5) return cur;
      return [...cur, id];
    });
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 pb-28 pt-5 sm:px-6 sm:pb-8">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-pitch text-bg" aria-hidden="true">
          <CircleDot size={23} strokeWidth={2.2} />
        </span>
        <h1 className="font-display text-2xl font-bold text-ink">BETAPP</h1>
      </header>

      <nav
        aria-label="Secciones principales"
        role="tablist"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:static sm:mb-6 sm:border-0 sm:bg-transparent sm:p-0"
      >
        <div className="mx-auto grid max-w-3xl grid-cols-4 gap-1 py-2 sm:py-0">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`${id}-tab`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`${id}-panel`}
              onClick={() => setTab(id)}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold sm:min-h-11 sm:flex-row sm:justify-start sm:gap-2 sm:px-4 sm:text-sm ${
                tab === id ? "bg-pitch text-bg sm:bg-pitch/10 sm:text-pitch" : "text-muted hover:bg-pitch/5"
              }`}
            >
              <Icon size={19} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {tab === "keys" && (
        <section id="keys-panel" role="tabpanel" aria-labelledby="keys-tab" className="space-y-4">
          <div>
            <h2 className="font-display text-2xl">APIs</h2>
            <p className="mt-1 text-sm text-muted">
              API-Football carga partidos y jugadores; Gemini genera pronósticos; football-data.org aporta la forma de la temporada actual.
            </p>
          </div>
          <div className="grid gap-4 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 sm:p-6">
            <label className="block text-sm font-semibold">
              API-Football
              <input
                type="password"
                autoComplete="off"
                value={footballKey}
                onChange={(e) => setFootballKey(e.target.value)}
                placeholder="x-apisports-key"
                className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-3"
              />
            </label>
            <label className="block text-sm font-semibold">
              Gemini
              <input
                type="password"
                autoComplete="off"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AI Studio API key"
                className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-3"
              />
            </label>
            <label className="block text-sm font-semibold sm:col-span-2">
              football-data.org
              <input
                type="password"
                autoComplete="off"
                value={fdKey}
                onChange={(e) => setFdKey(e.target.value)}
                placeholder="X-Auth-Token"
                className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-3"
              />
            </label>
            <label className="block text-sm font-semibold sm:col-span-2">
              Modelo Gemini
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-3"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={saveKeys}
                className="w-full rounded-xl bg-pitch px-4 py-3 font-semibold text-bg sm:w-auto"
              >
                Guardar claves
              </button>
              {saveFeedback && (
                <p
                  role={saveFeedback.isError ? "alert" : "status"}
                  className={`mt-3 text-sm ${saveFeedback.isError ? "text-warn" : "text-muted"}`}
                >
                  {saveFeedback.message}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === "matches" && (
        <section id="matches-panel" role="tabpanel" aria-labelledby="matches-tab" className="space-y-5">
          <div>
            <h2 className="font-display text-2xl">Partidos</h2>
            {(!footballKey || !geminiKey || !fdKey) && (
              <p className="mt-1 text-sm text-muted">
                Añade las claves de API-Football, Gemini y football-data.org en APIs para generar pronósticos actuales.
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <label className="block text-sm font-semibold">
              Fecha
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block min-h-12 w-full rounded-xl border border-line bg-surface px-3 py-3"
              />
            </label>
            <button
              type="button"
              disabled={busy !== null || !footballKey}
              onClick={onLoad}
              className="min-h-12 rounded-xl bg-pitch-deep px-4 py-3 font-semibold text-bg disabled:opacity-50"
            >
              {busy === "load" ? "Cargando…" : "Cargar jornada"}
            </button>
            <button
              type="button"
              disabled={busy !== null || picked.length === 0 || !footballKey || !geminiKey || !fdKey}
              onClick={onPredict}
              className="min-h-12 rounded-xl border border-pitch bg-surface px-4 py-3 font-semibold text-pitch disabled:opacity-50"
            >
              {busy === "predict" ? "Pronosticando…" : `Pronosticar (${picked.length}/5)`}
            </button>
          </div>

          <p className="text-xs text-muted">
            La forma se consulta en football-data.org para la temporada del partido. Las estadísticas de jugadores se incluyen solo si API-Football permite acceder a esa temporada; sin datos actuales, se omiten.
          </p>

          {note && <p role="status" className="text-sm text-muted">{note}</p>}
          {error && (
            <p role="alert" className="rounded-xl border border-warn bg-surface px-4 py-3 text-sm text-warn">
              {error}
            </p>
          )}

          {fixtures.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-sm text-muted">
              {busy === "load" ? "Buscando partidos…" : "Carga una jornada para ver los partidos disponibles."}
            </p>
          ) : (
            <div className="space-y-6">
              {groups.map(([league, rows]) => (
                <section key={league}>
                  <h3 className="mb-2 font-display text-xl">{league}</h3>
                  <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                    {rows.map((f) => {
                      const on = picked.includes(f.id);
                      const kick = new Date(f.date).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
                      return (
                        <li key={f.id}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggle(f.id)}
                            className={`flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left ${on ? "bg-pitch/10" : ""}`}
                          >
                            <span
                              className={`grid size-5 shrink-0 place-items-center rounded border ${on ? "border-pitch bg-pitch text-bg" : "border-line"}`}
                            >
                              {on ? "✓" : ""}
                            </span>
                            <span className="w-12 shrink-0 text-sm text-muted">{kick}</span>
                            <span className="min-w-0 flex-1 text-sm font-semibold sm:text-base">
                              {f.home} <span className="font-normal text-muted">vs</span> {f.away}
                            </span>
                            <span className="shrink-0 text-xs text-muted">{f.status}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "history" && (
        <section id="history-panel" role="tabpanel" aria-labelledby="history-tab">
          <h2 className="font-display text-2xl">Historial</h2>
          {results.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-line bg-surface px-4 py-6 text-sm text-muted">
              Todavía no hay pronósticos guardados.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {results.map((row) => (
                <li key={row.fixture.id} className="rounded-2xl border border-line bg-surface p-4">
                  <p className="text-sm text-muted">
                    {row.fixture.country} · {row.fixture.league}
                  </p>
                  <p className="font-display text-xl">
                    {row.fixture.home} – {row.fixture.away}
                  </p>
                  <p className="mt-2 text-lg font-semibold text-pitch">
                    Pick {row.prediction.pick} · confianza {row.prediction.confidence}
                  </p>
                  <p className="text-sm">
                    1 {row.prediction.probs?.home}% · X {row.prediction.probs?.draw}% · 2 {row.prediction.probs?.away}%
                    {" · "}Over 2.5 {row.prediction.over25}% · BTTS {row.prediction.btts}%
                  </p>
                  <p className="mt-2 text-sm text-muted">{row.prediction.reason}</p>
                  {row.prediction.recommendations?.length ? (
                    <div className="mt-4 border-t border-line pt-3">
                      <h3 className="text-sm font-semibold">Mercados con mejor respaldo</h3>
                      <ul className="mt-2 divide-y divide-line">
                        {row.prediction.recommendations.map((market) => (
                          <li key={market.id} className="py-3 first:pt-0 last:pb-0">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold">{market.title}</p>
                                <p className="text-sm text-pitch">{market.selection}</p>
                              </div>
                              <span className="shrink-0 text-sm font-semibold">{market.probability}%</span>
                            </div>
                            <p className="mt-1 text-xs text-muted">{market.evidence}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
                      No hay mercados con suficiente muestra para recomendar en este partido.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {tab === "bets" && <BetsPanel />}
    </main>
  );
}
