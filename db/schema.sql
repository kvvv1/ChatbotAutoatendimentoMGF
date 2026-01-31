-- Schema inicial baseado nos requisitos
-- Ajustaremos chaves/índices conforme integrações (SGC) e RLS

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  cpf varchar(14) not null,
  email text,
  name text,
  whatsapp_phone text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
create index if not exists idx_customers_cpf on customers(cpf);
create unique index if not exists ux_customers_whatsapp on customers(whatsapp_phone);

create table if not exists ligacoes (
  id uuid primary key default gen_random_uuid(),
  external_id text, -- id da ligação no SGC
  customer_id uuid references customers(id),
  numero_ligacao text not null,
  categoria text,
  servicos text[], -- ex.: água, esgoto
  situacao_abastecimento text,
  endereco_imovel text,
  endereco_correspondencia text,
  titular text,
  numero_hidrometro text,
  data_ativacao date,
  created_at timestamp with time zone default now()
);
create index if not exists idx_ligacoes_customer on ligacoes(customer_id);
create index if not exists idx_ligacoes_numero on ligacoes(numero_ligacao);

create table if not exists faturas (
  id uuid primary key default gen_random_uuid(),
  ligacao_id uuid references ligacoes(id),
  identificador text, -- número/ID da fatura
  referencia text, -- MM/YYYY
  vencimento date,
  valor numeric(14,2),
  debito_automatico boolean default false,
  linha_digitavel text,
  status text, -- em aberto, paga, vencida...
  url_pdf text, -- caso armazenado/espelhado
  created_at timestamp with time zone default now()
);
create index if not exists idx_faturas_ligacao on faturas(ligacao_id);
create index if not exists idx_faturas_status on faturas(status);

create table if not exists solicitacoes (
  id uuid primary key default gen_random_uuid(),
  ligacao_id uuid references ligacoes(id),
  tipo text, -- religacao, 2a via, vistoria...
  protocolo text,
  status text, -- aberto, em_andamento, concluido, cancelado
  detalhes jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
create index if not exists idx_solicitacoes_ligacao on solicitacoes(ligacao_id);
create index if not exists idx_solicitacoes_protocolo on solicitacoes(protocolo);

create table if not exists leituras (
  id uuid primary key default gen_random_uuid(),
  ligacao_id uuid references ligacoes(id),
  data_leitura date,
  consumo_real numeric(14,3),
  consumo_faturado numeric(14,3),
  media_consumo numeric(14,3),
  created_at timestamp with time zone default now()
);
create index if not exists idx_leituras_ligacao on leituras(ligacao_id);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  whatsapp_phone text not null,
  cpf varchar(14),
  ligacao_id uuid,
  action text not null, -- ex.: 'login', 'listar_ligacoes', 'enviar_fatura'
  payload jsonb,
  created_at timestamp with time zone default now()
);
create index if not exists idx_audit_phone on audit_logs(whatsapp_phone);
create index if not exists idx_audit_action on audit_logs(action);

create table if not exists sessions (
  phone text primary key,
  state jsonb not null,
  updated_at timestamp with time zone default now()
);



