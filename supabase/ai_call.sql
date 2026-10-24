-- One row per AI model call, and the count behind the daily per-store cap.
-- Run once in the Supabase SQL editor. Idempotent: safe to run again.
--
-- Each row says which store, which screen's route (extract, ask, reorder, feedback-triage),
-- which model, the token counts, and how it ended: ok, refused, cut_off, failed, or capped
-- (refused before reaching the model because the store hit today's limit). Metadata only:
-- never the prompt, the store data sent with it, or the answer. src/lib/aiUsage.ts writes
-- the rows and reads the count; the cap itself is AI_DAILY_CAP_PER_STORE in Vercel.

create table if not exists public.ai_call (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.store(id),
  route text not null,          -- extract, ask, reorder, feedback-triage
  model text,
  outcome text not null check (outcome in ('ok','refused','cut_off','failed','capped')),
  failure_kind text,            -- for failed: timeout, overloaded, bad_request, upstream
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists ai_call_store_day_idx on public.ai_call(store_id, created_at);

-- How many AI calls a store has made today, for the daily cap. SECURITY DEFINER so a staff
-- member's call still counts every call the store made today, although under enforced login
-- only the owner can read the rows. A signed-in caller always gets their own store's count,
-- whatever id is passed. plpgsql, not sql, so the auth_id lookup is only planned when it runs:
-- demo databases have no app_user.auth_id column and never take that branch. "Today" is the
-- store's calendar day in Ontario. Capped rows never reached the model, so they do not count.
create or replace function public.ai_calls_today(p_store_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store uuid := p_store_id;
begin
  if auth.uid() is not null then
    select u.store_id into v_store from public.app_user u where u.auth_id = auth.uid() limit 1;
  end if;
  return (
    select count(*)::int from public.ai_call c
    where c.store_id = v_store
      and c.outcome <> 'capped'
      and c.created_at >= date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto'
  );
end;
$$;

-- Row-level security: match the dev open policy pattern. If enforced auth is on
-- (NEXT_PUBLIC_REQUIRE_AUTH=true), rerun supabase/auth_setup.sql after this file: it gives
-- ai_call its owner-read, member-insert policies. Until then the table denies every member,
-- the app logs a warning instead of a row, and AI calls carry on uncapped.
alter table public.ai_call enable row level security;
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice' and policyname = 'dev_all') then
    drop policy if exists dev_all on public.ai_call;
    create policy dev_all on public.ai_call for all using (true) with check (true);
  end if;
end $$;
