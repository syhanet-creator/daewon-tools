create table if not exists public.pl_ledgers (
  id text primary key,
  title text not null,
  site_id text,
  site_name text,
  date_from text,
  date_to text,
  photo_ids jsonb not null default '[]'::jsonb,
  count int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.pl_ledgers enable row level security;
