-- 사진대지(photo-ledger) 전용 테이블. 프로젝트: khnlu-accounting (이미 적용됨, 기록용)
create table if not exists public.pl_sites (
  id text primary key, name text not null, lat double precision, lng double precision,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.pl_photos (
  id text primary key, site_id text references public.pl_sites(id) on delete set null,
  storage_path text not null, taken_at timestamptz not null,
  src_time text not null default 'exif', lat double precision, lng double precision,
  src_gps text not null default 'none', trade text not null default '', stage text not null default '',
  detail text not null default '', caption text not null default '', space text not null default '',
  confidence real not null default 0, review text not null default '', state text not null default 'new',
  user_edited boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists pl_photos_site_taken_idx on public.pl_photos (site_id, taken_at);
create index if not exists pl_photos_state_idx on public.pl_photos (state);
alter table public.pl_sites enable row level security;
alter table public.pl_photos enable row level security;
revoke all on public.pl_sites, public.pl_photos from anon, authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pl-photos','pl-photos',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
