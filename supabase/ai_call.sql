-- One row per AI model call, and the daily per-store cap that reads them.
-- Run once in the Supabase SQL editor. Idempotent: safe to run again.
--
-- Each row says which store, which screen's route (extract, ask, reorder, feedback-triage),
-- which model, the token counts, and how it ended: ok, refused, cut_off, failed, or capped
-- (refused before reaching the model because the store hit today's limit). pending is a call
-- still in flight, or one whose function was stopped before it could say how it ended.
-- Metadata only: never the prompt, the store data sent with it, or the answer.
-- src/lib/aiUsage.ts calls the two functions below; the cap itself is AI_DAILY_CAP_PER_STORE.

create table if not exists public.ai_call (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.store(id),
  route text not null,          -- extract, ask, reorder, feedback-triage
  model text,
  outcome text not null check (outcome in ('pending','ok','refused','cut_off','failed','capped')),
  failure_kind text,            -- for failed: timeout, overloaded, bad_request, upstream
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists ai_call_store_day_idx on public.ai_call(store_id, created_at);

-- Reserve one AI call for a store, or refuse it, before the model is called. Counting and
-- inserting happen under a per-store lock in one transaction, so a burst of parallel requests
-- cannot all see room under the cap. Every row but capped counts, pending included, because a
-- call in flight is already being paid for. "Today" is the store's calendar day in Ontario.
-- SECURITY DEFINER because members write only through this and ai_call_finish (they have no
-- insert policy) and only the owner can read the rows. A signed-in caller always uses their
-- own store, whatever id is passed. plpgsql, not sql, so the auth_id lookup is only planned
-- when it runs: demo databases have no app_user.auth_id column and never take that branch.
-- Returns {"allowed": bool, "id": uuid or null}; the id is what ai_call_finish fills in.
create or replace function public.ai_call_begin(p_store_id uuid, p_route text, p_model text, p_cap integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid := p_store_id;
  v_used integer;
  v_id uuid;
begin
  if auth.uid() is not null then
    select u.store_id into v_store from public.app_user u where u.auth_id = auth.uid() limit 1;
  end if;
  if v_store is null then
    return jsonb_build_object('allowed', true, 'id', null);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_call:' || v_store::text, 0));
  select count(*) into v_used from public.ai_call c
  where c.store_id = v_store
    and c.outcome <> 'capped'
    and c.created_at >= date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto';
  if v_used >= greatest(coalesce(p_cap, 1), 1) then
    insert into public.ai_call (store_id, route, model, outcome)
    values (v_store, left(p_route, 40), left(p_model, 100), 'capped');
    return jsonb_build_object('allowed', false, 'id', null);
  end if;
  insert into public.ai_call (store_id, route, model, outcome)
  values (v_store, left(p_route, 40), left(p_model, 100), 'pending')
  returning id into v_id;
  return jsonb_build_object('allowed', true, 'id', v_id);
end;
$$;

-- Say how a reserved call ended. Only a pending row of the caller's own store changes, once.
-- capped is never accepted here, so finishing a row can never take it out of today's count.
create or replace function public.ai_call_finish(
  p_id uuid, p_outcome text, p_model text, p_failure_kind text,
  p_input_tokens integer, p_output_tokens integer,
  p_cache_read_tokens integer, p_cache_write_tokens integer, p_duration_ms integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
begin
  if p_outcome is null or p_outcome not in ('ok','refused','cut_off','failed') then
    raise exception 'ai_call_finish: outcome % is not allowed', p_outcome;
  end if;
  if auth.uid() is not null then
    select u.store_id into v_store from public.app_user u where u.auth_id = auth.uid() limit 1;
    if v_store is null then
      return;
    end if;
  end if;
  update public.ai_call c
  set outcome = p_outcome,
      model = coalesce(left(p_model, 100), c.model),
      failure_kind = left(p_failure_kind, 40),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      cache_read_tokens = p_cache_read_tokens,
      cache_write_tokens = p_cache_write_tokens,
      duration_ms = p_duration_ms
  where c.id = p_id
    and c.outcome = 'pending'
    and (v_store is null or c.store_id = v_store);
end;
$$;

-- Row-level security: match the dev open policy pattern. With enforced login
-- (NEXT_PUBLIC_REQUIRE_AUTH=true) there is no dev policy to copy; instead anonymous callers
-- lose execute on the two functions here, so the cap works from the first merge. Rerun
-- supabase/auth_setup.sql after this file to give the owner read access to the rows.
alter table public.ai_call enable row level security;
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice' and policyname = 'dev_all') then
    drop policy if exists dev_all on public.ai_call;
    create policy dev_all on public.ai_call for all using (true) with check (true);
  else
    revoke execute on function public.ai_call_begin(uuid, text, text, integer) from public, anon;
    revoke execute on function public.ai_call_finish(uuid, text, text, text, integer, integer, integer, integer, integer) from public, anon;
    grant execute on function public.ai_call_begin(uuid, text, text, integer) to authenticated;
    grant execute on function public.ai_call_finish(uuid, text, text, text, integer, integer, integer, integer, integer) to authenticated;
  end if;
end $$;
