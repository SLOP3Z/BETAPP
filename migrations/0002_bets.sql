-- Apuestas registradas y saldo inicial (compartidos por todos los que usan la misma base de datos).

create table if not exists bets (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  selection text not null default '',
  odds numeric(8, 2) not null check (odds > 1),
  stake numeric(12, 2) not null check (stake > 0),
  status text not null default 'pending' check (status in ('pending', 'won', 'lost')),
  placed_at timestamptz not null default now()
);

create index if not exists bets_placed_at_idx on bets (placed_at desc);

-- Una sola fila (id = 1) con el saldo con el que se empieza.
create table if not exists bankroll_settings (
  id integer primary key default 1 check (id = 1),
  initial_balance numeric(12, 2) not null default 100 check (initial_balance >= 0)
);

insert into bankroll_settings (id) values (1) on conflict (id) do nothing;
