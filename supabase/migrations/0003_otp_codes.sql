-- OTP storage with TTL and usage tracking
create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text,          -- whatsapp phone (opcional)
  cpf varchar(14) not null,
  email text not null,
  code text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists otp_codes_cpf_email_idx on public.otp_codes(cpf, email);
create index if not exists otp_codes_expires_idx on public.otp_codes(expires_at);

create or replace function public.otp_codes_set_updated_at()
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
  if not exists (select 1 from pg_trigger where tgname = 'otp_codes_updated_trg') then
    create trigger otp_codes_updated_trg before update on public.otp_codes
    for each row execute procedure public.otp_codes_set_updated_at();
  end if;
end$$;

alter table public.otp_codes enable row level security;


