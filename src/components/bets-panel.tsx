import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  addBet,
  deleteBet,
  loadBets,
  setBetStatus,
  setInitialBalance,
  type Bet,
  type BetStatus,
  type BetsSnapshot,
} from "@/lib/bets.functions";

const STATUS_LABEL: Record<BetStatus, string> = {
  pending: "Pendiente",
  won: "Ganada",
  lost: "Perdida",
};

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function BetsPanel() {
  const [data, setData] = useState<BetsSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [balanceDraft, setBalanceDraft] = useState("");
  const [event, setEvent] = useState("");
  const [selection, setSelection] = useState("");
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState("");
  const [error, setError] = useState("");

  const initialBalance = data?.initialBalance ?? 0;
  const bets: Bet[] = useMemo(() => data?.bets ?? [], [data]);

  const refresh = useCallback(async () => {
    try {
      setData(await loadBets());
      setLoadError("");
    } catch (err) {
      setLoadError(messageOf(err, "No se pudieron cargar las apuestas."));
    }
  }, []);

  // Carga al abrir la pestaña y cada vez que vuelves a la ventana (por si tu compañero ha apostado).
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (data) setBalanceDraft(String(data.initialBalance));
  }, [data]);

  async function run(action: () => Promise<BetsSnapshot>): Promise<boolean> {
    setBusy(true);
    try {
      setData(await action());
      setError("");
      return true;
    } catch (err) {
      setError(messageOf(err, "No se pudo guardar el cambio."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const stats = useMemo(() => {
    let staked = 0;
    let returned = 0;
    let pendingStake = 0;
    let settledStake = 0;
    let won = 0;
    let lost = 0;
    let pending = 0;
    for (const b of bets) {
      staked += b.stake;
      if (b.status === "won") {
        returned += b.stake * b.odds;
        settledStake += b.stake;
        won += 1;
      } else if (b.status === "lost") {
        settledStake += b.stake;
        lost += 1;
      } else {
        pendingStake += b.stake;
        pending += 1;
      }
    }
    const available = round2(initialBalance - staked + returned);
    const net = round2(returned - settledStake);
    const settled = won + lost;
    return {
      available,
      net,
      pendingStake: round2(pendingStake),
      won,
      lost,
      pending,
      hitRate: settled ? Math.round((won / settled) * 100) : null,
      roi: settledStake > 0 ? Math.round((net / settledStake) * 1000) / 10 : null,
    };
  }, [bets, initialBalance]);

  const oddsNum = Number(odds);
  const stakeNum = Number(stake);
  const previewOk = oddsNum > 1 && stakeNum > 0;
  const potentialReturn = previewOk ? round2(stakeNum * oddsNum) : 0;
  const potentialProfit = previewOk ? round2(potentialReturn - stakeNum) : 0;

  const balanceNum = Number(balanceDraft);
  const balanceValid = balanceDraft.trim() !== "" && Number.isFinite(balanceNum) && balanceNum >= 0;

  function saveBalance(e: React.FormEvent) {
    e.preventDefault();
    if (!balanceValid) return;
    void run(() => setInitialBalance({ data: { value: balanceNum } }));
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!event.trim()) {
      setError("Escribe el partido o la apuesta.");
      return;
    }
    if (!(oddsNum > 1)) {
      setError("La cuota debe ser mayor que 1.");
      return;
    }
    if (!(stakeNum > 0)) {
      setError("El importe apostado debe ser mayor que 0.");
      return;
    }
    if (round2(stakeNum) > stats.available) {
      setError(`No tienes saldo suficiente. Disponible: ${money.format(stats.available)}.`);
      return;
    }
    const ok = await run(() =>
      addBet({
        data: { event: event.trim(), selection: selection.trim(), odds: oddsNum, stake: stakeNum },
      }),
    );
    if (ok) {
      setEvent("");
      setSelection("");
      setOdds("");
      setStake("");
    }
  }

  function onStatus(id: string, status: BetStatus) {
    void run(() => setBetStatus({ data: { id, status } }));
  }

  function onRemove(id: string) {
    if (window.confirm("¿Borrar esta apuesta? El saldo se recalculará.")) {
      void run(() => deleteBet({ data: { id } }));
    }
  }

  const inputClass = "mt-1 w-full rounded-xl border border-line bg-bg px-3 py-3";

  return (
    <section id="bets-panel" role="tabpanel" aria-labelledby="bets-tab" className="space-y-5">
      <h2 className="font-display text-2xl">Apuestas</h2>

      {loadError && (
        <div role="alert" className="rounded-xl border border-warn px-4 py-3 text-sm text-warn">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-2 font-semibold underline"
          >
            Reintentar
          </button>
        </div>
      )}
      {!data && !loadError && <p className="text-sm text-muted">Cargando apuestas…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 rounded-2xl border border-pitch bg-pitch/10 p-4 sm:col-span-2">
              <p className="text-sm text-muted">Dinero disponible</p>
              <p className="font-display text-3xl text-pitch">{money.format(stats.available)}</p>
              {stats.pendingStake > 0 && (
                <p className="text-xs text-muted">{money.format(stats.pendingStake)} en juego</p>
              )}
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">Beneficio neto</p>
              <p className={`font-display text-2xl ${stats.net < 0 ? "text-warn" : "text-pitch"}`}>
                {stats.net > 0 ? "+" : ""}
                {money.format(stats.net)}
              </p>
              {stats.roi !== null && <p className="text-xs text-muted">ROI {stats.roi}%</p>}
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">Ganadas / Perdidas</p>
              <p className="font-display text-2xl">
                <span className="text-pitch">{stats.won}</span>
                {" / "}
                <span className="text-warn">{stats.lost}</span>
              </p>
              <p className="text-xs text-muted">
                {stats.hitRate !== null ? `${stats.hitRate}% de acierto` : "Sin cerrar"}
                {stats.pending > 0 ? ` · ${stats.pending} pendiente(s)` : ""}
              </p>
            </div>
          </div>

          <form onSubmit={saveBalance} className="flex max-w-sm items-end gap-2">
            <label className="block flex-1 text-sm font-semibold">
              Saldo inicial (€)
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={balanceDraft}
                onChange={(e) => setBalanceDraft(e.target.value)}
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              disabled={busy || !balanceValid || round2(balanceNum) === initialBalance}
              className="min-h-12 rounded-xl border border-pitch bg-surface px-4 font-semibold text-pitch disabled:opacity-50"
            >
              Guardar
            </button>
          </form>

          <form
            onSubmit={onAdd}
            className="grid gap-4 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 sm:p-6"
          >
            <label className="block text-sm font-semibold sm:col-span-2">
              Partido
              <input
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                placeholder="Ej. Barcelona – Real Madrid"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-semibold sm:col-span-2">
              Apuesta / mercado (opcional)
              <input
                value={selection}
                onChange={(e) => setSelection(e.target.value)}
                placeholder="Ej. 1X2: Local, Over 2.5…"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-semibold">
              Cuota
              <input
                type="number"
                inputMode="decimal"
                min="1.01"
                step="0.01"
                value={odds}
                onChange={(e) => setOdds(e.target.value)}
                placeholder="1.85"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-semibold">
              Importe apostado (€)
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                placeholder="10"
                className={inputClass}
              />
            </label>
            <p className="text-sm text-muted sm:col-span-2" aria-live="polite">
              {previewOk
                ? `Ganarías ${money.format(potentialReturn)} en total (beneficio ${money.format(potentialProfit)}).`
                : "Introduce cuota e importe para ver cuánto ganarías."}
            </p>
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-warn px-4 py-3 text-sm text-warn sm:col-span-2"
              >
                {error}
              </p>
            )}
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-pitch px-4 py-3 font-semibold text-bg disabled:opacity-50 sm:w-auto"
              >
                Registrar apuesta
              </button>
            </div>
          </form>

          {bets.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-sm text-muted">
              Todavía no has registrado ninguna apuesta.
            </p>
          ) : (
            <ul className="grid gap-3">
              {bets.map((b) => {
                const ret = round2(b.stake * b.odds);
                return (
                  <li key={b.id} className="rounded-2xl border border-line bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-lg">{b.event}</p>
                        {b.selection && <p className="text-sm text-muted">{b.selection}</p>}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                          b.status === "won"
                            ? "bg-pitch text-bg"
                            : b.status === "lost"
                              ? "bg-warn text-bg"
                              : "border border-line text-muted"
                        }`}
                      >
                        {STATUS_LABEL[b.status]}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">
                      Cuota <strong>{b.odds.toFixed(2)}</strong> · Apostado{" "}
                      <strong>{money.format(b.stake)}</strong> · Ganarías{" "}
                      <strong>{money.format(ret)}</strong>
                      {b.status === "won" && (
                        <span className="text-pitch">
                          {" "}
                          · +{money.format(round2(ret - b.stake))}
                        </span>
                      )}
                      {b.status === "lost" && (
                        <span className="text-warn"> · −{money.format(b.stake)}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {new Date(b.placedAt).toLocaleString("es", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(["won", "lost", "pending"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={b.status === s}
                          disabled={busy}
                          onClick={() => onStatus(b.id, s)}
                          className={`min-h-10 rounded-xl border px-3 text-sm font-semibold disabled:opacity-50 ${
                            b.status === s
                              ? "border-pitch bg-pitch/10 text-pitch"
                              : "border-line text-muted"
                          }`}
                        >
                          {s === "won" ? "Ganada" : s === "lost" ? "Perdida" : "Pendiente"}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRemove(b.id)}
                        aria-label={`Borrar apuesta ${b.event}`}
                        className="ml-auto grid min-h-10 min-w-10 place-items-center rounded-xl border border-line text-muted"
                      >
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
