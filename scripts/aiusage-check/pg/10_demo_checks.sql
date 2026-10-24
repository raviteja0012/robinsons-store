-- Demo mode (schema.sql, dev_all): reserve, refuse at the cap, finish, and the day boundary.
\set ON_ERROR_STOP on
insert into store (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Store A'),
  ('22222222-2222-2222-2222-222222222222', 'Store B'),
  ('33333333-3333-3333-3333-333333333333', 'Store C, lock test'),
  ('44444444-4444-4444-4444-444444444444', 'Store D, burst test');

select 'dev_all on ai_call' as check, count(*) = 1 as ok
  from pg_policies where tablename = 'ai_call' and policyname = 'dev_all';

-- One from just before Ontario midnight today, which must not count.
insert into ai_call (store_id, route, outcome, created_at)
values ('11111111-1111-1111-1111-111111111111', 'ask', 'ok',
        (date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto') - interval '1 second');

-- As anon (the demo server's key). Cap 3: three reservations, then refused.
set role anon;
select (public.ai_call_begin('11111111-1111-1111-1111-111111111111', 'ask', 'claude-sonnet-5', 3))->>'id' as id1 \gset
select (public.ai_call_begin('11111111-1111-1111-1111-111111111111', 'extract', 'claude-sonnet-5', 3))->>'id' as id2 \gset
select (public.ai_call_begin('11111111-1111-1111-1111-111111111111', 'reorder', 'claude-sonnet-5', 3))->>'id' as id3 \gset
select 'three reservations under cap 3' as check, :'id1' <> '' and :'id2' <> '' and :'id3' <> '' as ok;
select 'fourth is refused (yesterday row not counted)' as check,
       public.ai_call_begin('11111111-1111-1111-1111-111111111111', 'ask', 'claude-sonnet-5', 3) = '{"id": null, "allowed": false}'::jsonb as ok;
select 'refusal recorded as capped' as check, count(*) = 1 as ok from ai_call where outcome = 'capped';
select 'capped rows do not count: cap 4 still has room' as check,
       (public.ai_call_begin('11111111-1111-1111-1111-111111111111', 'ask', 'claude-sonnet-5', 4))->>'allowed' = 'true' as ok;
select 'store B has its own allowance' as check,
       (public.ai_call_begin('22222222-2222-2222-2222-222222222222', 'ask', 'claude-sonnet-5', 3))->>'allowed' = 'true' as ok;

-- Finish: once, never as capped.
select public.ai_call_finish(:'id1', 'ok', 'claude-sonnet-5-x', null, 1200, 300, 1000, 50, 2100);
select 'finish fills the row' as check,
       outcome = 'ok' and model = 'claude-sonnet-5-x' and input_tokens = 1200 and output_tokens = 300
       and cache_read_tokens = 1000 and cache_write_tokens = 50 and duration_ms = 2100 as ok
  from ai_call where id = :'id1';
select public.ai_call_finish(:'id1', 'failed', null, 'timeout', null, null, null, null, 1);
select 'second finish changes nothing' as check, outcome = 'ok' and failure_kind is null as ok from ai_call where id = :'id1';
do $$ begin
  perform public.ai_call_finish((select id from ai_call where outcome = 'pending' limit 1), 'capped', null, null, null, null, null, null, 0);
  raise exception 'FAIL finish accepted capped';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'finish refuses capped: ok';
end $$;
reset role;

-- A bad outcome is refused by the check constraint.
do $$ begin
  insert into ai_call (store_id, route, outcome) values ('11111111-1111-1111-1111-111111111111', 'ask', 'cut off');
  raise exception 'outcome check did not fire';
exception when check_violation then raise notice 'outcome check fires: ok';
end $$;
