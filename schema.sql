-- Egan Hoops (🏀) Supabase Schema
-- Run this in your Supabase Project -> SQL Editor to initialize the database

-- 1. Sessions table (tracks games and admin announcements)
create table if not exists public.sessions (
  id text primary key, -- formatted as YYYY-MM-DD, e.g., '2026-10-22'
  event_date date not null,
  start_time text not null default '18:30',
  end_time text not null default '20:15',
  location text not null default 'Egan Junior High School, 100 W Portola Ave, Los Altos, CA',
  is_cancelled boolean not null default false,
  cancellation_reason text,
  announcement text, -- pinned banner for this session
  created_at timestamp with time zone default now()
);

-- 2. RSVPs table (stores player attendance and guests)
create table if not exists public.rsvps (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  player_name text not null,
  status text not null check (status in ('in', 'out')),
  guest_count integer not null default 0 check (guest_count >= 0 and guest_count <= 5),
  guest_names text,
  note text,
  device_id text,
  updated_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  unique (session_id, player_name)
);

-- 3. Global announcements & settings table
create table if not exists public.site_settings (
  key text primary key,
  value text not null,
  updated_at timestamp with time zone default now()
);

-- 4. Enable Row Level Security (RLS) with permissive read/write for zero-friction access
alter table public.sessions enable row level security;
alter table public.rsvps enable row level security;
alter table public.site_settings enable row level security;

create policy "Allow public read access on sessions" on public.sessions for select using (true);
create policy "Allow public insert/update on sessions" on public.sessions for all using (true);

create policy "Allow public read access on rsvps" on public.rsvps for select using (true);
create policy "Allow public insert/update/delete on rsvps" on public.rsvps for all using (true);

create policy "Allow public read access on site_settings" on public.site_settings for select using (true);
create policy "Allow public insert/update on site_settings" on public.site_settings for all using (true);

-- 5. Enable Realtime on RSVPs and Sessions tables
alter publication supabase_realtime add table public.rsvps;
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.site_settings;
