-- Enable extensions commonly used
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Tables
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  cpf varchar(14) not null,
  email text,
  name text,
  whatsapp_phone text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists customers_cpf_idx on public.customers(cpf);
create unique index if not exists customers_whatsapp_phone_ux on public.customers(whatsapp_phone);

create table if not exists public.ligacoes (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  customer_id uuid references public.customers(id) on delete set null,
  numero_ligacao text not null,
  categoria text,
  servicos text[],
  situacao_abastecimento text,
  endereco_imovel text,
  endereco_correspondencia text,
  titular text,
  numero_hidrometro text,
  data_ativacao date,
  created_at timestamptz default now()
);
create index if not exists ligacoes_customer_id_idx on public.ligacoes(customer_id);
create index if not exists ligacoes_numero_ligacao_idx on public.ligacoes(numero_ligacao);

create table if not exists public.faturas (
  id uuid primary key default gen_random_uuid(),
  ligacao_id uuid references public.ligacoes(id) on delete cascade,
  identificador text,
  referencia text,
  vencimento date,
  valor numeric(14,2),
  debito_automatico boolean default false,
  linha_digitavel text,
  status text,
  url_pdf text,
  created_at timestamptz default now()
);
create index if not exists faturas_ligacao_id_idx on public.faturas(ligacao_id);
create index if not exists faturas_status_idx on public.faturas(status);

create table if not exists public.solicitacoes (
  id uuid primary key default gen_random_uuid(),
  ligacao_id uuid references public.ligacoes(id) on delete cascade,
  tipo text,
  protocolo text,
  status text,
  detalhes jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists solicitacoes_ligacao_id_idx on public.solicitacoes(ligacao_id);
create index if not exists solicitacoes_protocolo_idx on public.solicitacoes(protocolo);

create table if not exists public.leituras (
  id uuid primary key default gen_random_uuid(),
  ligacao_id uuid references public.ligacoes(id) on delete cascade,
  data_leitura date,
  consumo_real numeric(14,3),
  consumo_faturado numeric(14,3),
  media_consumo numeric(14,3),
  created_at timestamptz default now()
);
create index if not exists leituras_ligacao_id_idx on public.leituras(ligacao_id);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  whatsapp_phone text not null,
  cpf varchar(14),
  ligacao_id uuid,
  action text not null,
  payload jsonb,
  created_at timestamptz default now()
);
create index if not exists audit_logs_phone_idx on public.audit_logs(whatsapp_phone);
create index if not exists audit_logs_action_idx on public.audit_logs(action);

create table if not exists public.sessions (
  phone text primary key,
  state jsonb not null,
  updated_at timestamptz default now()
);

-- Updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Triggers
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'customers_set_updated_at'
  ) then
    create trigger customers_set_updated_at before update on public.customers
    for each row execute procedure public.set_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'solicitacoes_set_updated_at'
  ) then
    create trigger solicitacoes_set_updated_at before update on public.solicitacoes
    for each row execute procedure public.set_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'sessions_set_updated_at'
  ) then
    create trigger sessions_set_updated_at before update on public.sessions
    for each row execute procedure public.set_updated_at();
  end if;
end$$;

-- RLS
alter table public.customers enable row level security;
alter table public.ligacoes enable row level security;
alter table public.faturas enable row level security;
alter table public.solicitacoes enable row level security;
alter table public.leituras enable row level security;
alter table public.audit_logs enable row level security;
alter table public.sessions enable row level security;

-- No policies created intentionally; service role bypasses RLS.

-- Utility function: audit
create or replace function public.log_audit(
  p_whatsapp_phone text,
  p_cpf varchar(14),
  p_ligacao_id uuid,
  p_action text,
  p_payload jsonb
) returns void
language sql
as $$
  insert into public.audit_logs (whatsapp_phone, cpf, ligacao_id, action, payload)
  values (p_whatsapp_phone, p_cpf, p_ligacao_id, p_action, p_payload);
$$;

-- Utility function: upsert session
create or replace function public.upsert_session(
  p_phone text,
  p_state jsonb
) returns void
language sql
as $$
  insert into public.sessions (phone, state)
  values (p_phone, p_state)
  on conflict (phone) do update set state = excluded.state, updated_at = now();
$$;



