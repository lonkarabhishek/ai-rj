-- MyRJ accounts: per-user prefs, taste seeds, and provider tokens.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  prefs jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles: read own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: insert own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create table if not exists public.taste_seeds (
  user_id uuid not null references auth.users(id) on delete cascade,
  uri text not null,
  track jsonb not null,
  source text,
  created_at timestamptz not null default now(),
  primary key (user_id, uri)
);
alter table public.taste_seeds enable row level security;
create policy "seeds: read own" on public.taste_seeds for select to authenticated using ((select auth.uid()) = user_id);
create policy "seeds: insert own" on public.taste_seeds for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "seeds: update own" on public.taste_seeds for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "seeds: delete own" on public.taste_seeds for delete to authenticated using ((select auth.uid()) = user_id);

-- Provider tokens (Spotify, YouTube). RLS on with NO policies and no grants:
-- only the server (service role) can touch it. Values are AES-GCM encrypted by the app.
create table if not exists public.provider_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('spotify', 'google')),
  refresh_token_enc text not null,
  scope text,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.provider_tokens enable row level security;
revoke all on public.provider_tokens from anon, authenticated;
