-- After ai_call.sql, before auth_setup.sql is rerun: deny-all, count still answers.
\set ON_ERROR_STOP on
select 'live: no policies yet' as check, count(*) = 0 as ok from pg_policies where tablename = 'ai_call';
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000b', false) is not null as staff_a;
set role authenticated;
do $$ begin
  insert into ai_call (store_id, route, outcome) values ('11111111-1111-1111-1111-111111111111', 'ask', 'ok');
  raise exception 'FAIL insert allowed before auth_setup';
exception when insufficient_privilege then raise notice 'live: insert denied until auth_setup rerun: ok';
end $$;
select 'live: count answers 0, so calls run uncapped' as check,
       public.ai_calls_today('11111111-1111-1111-1111-111111111111') = 0 as ok;
reset role;
