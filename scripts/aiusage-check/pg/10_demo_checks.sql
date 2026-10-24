-- Demo mode (schema.sql, dev_all): table, open policy, count boundary.
\set ON_ERROR_STOP on
insert into store (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Store A'),
  ('22222222-2222-2222-2222-222222222222', 'Store B');

select 'dev_all on ai_call' as check, count(*) = 1 as ok
  from pg_policies where tablename = 'ai_call' and policyname = 'dev_all';

-- As anon (the demo server's key): insert and count.
set role anon;
insert into ai_call (store_id, route, model, outcome, input_tokens, output_tokens)
values ('11111111-1111-1111-1111-111111111111', 'ask', 'claude-sonnet-5', 'ok', 100, 20),
       ('11111111-1111-1111-1111-111111111111', 'extract', 'claude-sonnet-5', 'failed', null, null),
       ('11111111-1111-1111-1111-111111111111', 'ask', 'claude-sonnet-5', 'capped', null, null),
       ('22222222-2222-2222-2222-222222222222', 'ask', 'claude-sonnet-5', 'ok', 1, 1);
reset role;
-- One from before Ontario midnight today, which must not count.
insert into ai_call (store_id, route, outcome, created_at)
values ('11111111-1111-1111-1111-111111111111', 'ask', 'ok',
        (date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto') - interval '1 second');
set role anon;
select 'demo count store A = 2 (ok + failed; capped and yesterday excluded)' as check,
       public.ai_calls_today('11111111-1111-1111-1111-111111111111') = 2 as ok;
select 'demo count store B = 1' as check, public.ai_calls_today('22222222-2222-2222-2222-222222222222') = 1 as ok;
reset role;

-- A bad outcome is refused by the check constraint.
do $$ begin
  insert into ai_call (store_id, route, outcome) values ('11111111-1111-1111-1111-111111111111', 'ask', 'cut off');
  raise exception 'outcome check did not fire';
exception when check_violation then raise notice 'outcome check fires: ok';
end $$;
