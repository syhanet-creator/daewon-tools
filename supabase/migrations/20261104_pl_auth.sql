create table if not exists public.pl_auth (
  id int primary key default 1 check (id = 1),
  pw_hash text not null,
  salt text not null,
  ver int not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists public.pl_auth_fail (
  id int primary key default 1 check (id = 1),
  fails int not null default 0,
  locked_until timestamptz
);
alter table public.pl_auth enable row level security;
alter table public.pl_auth_fail enable row level security;
