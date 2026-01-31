-- Tabelas adicionais para logging e controle de atendimento humano

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  direction text not null check (direction in ('in','out')),
  content text not null,
  created_at timestamptz default now()
);
create index if not exists messages_phone_created_idx on public.messages(phone, created_at desc);

create table if not exists public.human_tickets (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  status text not null check (status in ('pendente','em_atendimento','finalizado','cancelado')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists human_tickets_phone_status_idx on public.human_tickets(phone, status);

create or replace function public.human_tickets_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'human_tickets_updated_trg') then
    create trigger human_tickets_updated_trg before update on public.human_tickets
    for each row execute procedure public.human_tickets_set_updated_at();
  end if;
end$$;



