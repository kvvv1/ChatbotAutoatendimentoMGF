-- Responsavel por ticket e anotacoes internas da equipe

alter table if exists public.human_tickets
  add column if not exists assigned_attendant text;

create table if not exists public.human_ticket_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.human_tickets(id) on delete cascade,
  author text not null,
  note text not null,
  created_at timestamptz default now()
);

create index if not exists human_ticket_notes_ticket_created_idx
  on public.human_ticket_notes(ticket_id, created_at desc);
