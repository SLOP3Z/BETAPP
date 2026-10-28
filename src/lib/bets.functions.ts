import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";

export type BetStatus = "pending" | "won" | "lost";

export type Bet = {
  id: string;
  event: string;
  selection: string;
  odds: number;
  stake: number;
  status: BetStatus;
  placedAt: string;
};

export type BetsSnapshot = { initialBalance: number; bets: Bet[] };

const STATUSES: readonly BetStatus[] = ["pending", "won", "lost"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_BALANCE = 100;

type BetRow = {
  id: string;
  event: string;
  selection: string;
  odds: string | number;
  stake: string | number;
  status: BetStatus;
  placed_at: string | Date;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function text(value: unknown, field: string, max: number, required: boolean): string {
  if (typeof value !== "string") throw new Error(`${field} no es válido.`);
  const out = value.trim();
  if (required && !out) throw new Error(`${field} es obligatorio.`);
  if (out.length > max) throw new Error(`${field} es demasiado largo.`);
  return out;
}

function betId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Identificador no válido.");
  return value;
}

async function snapshot(sql: Sql): Promise<BetsSnapshot> {
  const settings = await sql<{ initial_balance: string | number }>`
    select initial_balance from bankroll_settings where id = 1`;
  const rows = await sql<BetRow>`
    select id, event, selection, odds, stake, status, placed_at
    from bets
    order by placed_at desc, id`;
  return {
    initialBalance: settings[0] ? Number(settings[0].initial_balance) : DEFAULT_BALANCE,
    bets: rows.map((r) => ({
      id: r.id,
      event: r.event,
      selection: r.selection,
      odds: Number(r.odds),
      stake: Number(r.stake),
      status: r.status,
      placedAt: new Date(r.placed_at).toISOString(),
    })),
  };
}

export const loadBets = createServerFn({ method: "GET" }).handler(async () => {
  return snapshot(await getSql());
});

export const addBet = createServerFn({ method: "POST" })
  .validator((data: { event: string; selection: string; odds: number; stake: number }) => {
    const event = text(data?.event, "El partido", 200, true);
    const selection = text(data?.selection ?? "", "La apuesta", 200, false);
    const odds = Number(data?.odds);
    const stake = Number(data?.stake);
    if (!Number.isFinite(odds) || odds <= 1 || odds > 1000) {
      throw new Error("La cuota debe ser mayor que 1.");
    }
    if (!Number.isFinite(stake) || stake <= 0 || stake > 10_000_000) {
      throw new Error("El importe apostado debe ser mayor que 0.");
    }
    return { event, selection, odds: round2(odds), stake: round2(stake) };
  })
  .handler(async ({ data }) => {
    const sql = await getSql();
    // El saldo se vuelve a comprobar en el servidor (por si tu compañero ha apostado desde que
    // cargaste la pantalla). Solo inserta si el importe cabe en el saldo disponible.
    const inserted = await sql<{ id: string }>`
      insert into bets (event, selection, odds, stake)
      select ${data.event}::text, ${data.selection}::text, ${data.odds}::numeric, ${data.stake}::numeric
      where ${data.stake}::numeric <= (
        select s.initial_balance
               - coalesce(sum(b.stake), 0)
               + coalesce(sum(case when b.status = 'won' then b.stake * b.odds end), 0)
        from bankroll_settings s
        left join bets b on true
        where s.id = 1
        group by s.initial_balance
      )
      returning id`;
    if (inserted.length === 0) throw new Error("No tienes saldo suficiente para esta apuesta.");
    return snapshot(sql);
  });

export const setBetStatus = createServerFn({ method: "POST" })
  .validator((data: { id: string; status: BetStatus }) => {
    const id = betId(data?.id);
    if (!STATUSES.includes(data?.status)) throw new Error("Estado no válido.");
    return { id, status: data.status };
  })
  .handler(async ({ data }) => {
    const sql = await getSql();
    const updated = await sql<{ id: string }>`
      update bets set status = ${data.status}::text where id = ${data.id}::uuid returning id`;
    if (updated.length === 0) throw new Error("La apuesta ya no existe.");
    return snapshot(sql);
  });

export const deleteBet = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => ({ id: betId(data?.id) }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`delete from bets where id = ${data.id}::uuid`;
    return snapshot(sql);
  });

export const setInitialBalance = createServerFn({ method: "POST" })
  .validator((data: { value: number }) => {
    const value = Number(data?.value);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
      throw new Error("El saldo inicial no es válido.");
    }
    return { value: round2(value) };
  })
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`
      insert into bankroll_settings (id, initial_balance) values (1, ${data.value}::numeric)
      on conflict (id) do update set initial_balance = excluded.initial_balance`;
    return snapshot(sql);
  });
