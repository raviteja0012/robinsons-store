-- Enforced mode (after auth_setup.sql): owner reads, staff only inserts, count stays scoped.
\set ON_ERROR_STOP on
select 'dev_all gone from ai_call' as check, count(*) = 0 as ok
  from pg_policies where tablename = 'ai_call' and policyname = 'dev_all';
select 'exactly the two ai_call policies' as check,
       string_agg(policyname || ':' || cmd, ',' order by policyname) = 'member_insert_own_store:INSERT,owner_read:SELECT' as ok
  from pg_policies where tablename = 'ai_call';
select 'members linked' as check, count(*) = 4 as ok from app_user where auth_id is not null;

-- Staff of store A.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000b', false) is not null as staff_a;
set role authenticated;
insert into ai_call (store_id, route, model, outcome) values ('11111111-1111-1111-1111-111111111111', 'extract', 'claude-sonnet-5', 'ok');
select 'staff: inserts own store' as check, true as ok;
do $$ begin
  insert into ai_call (store_id, route, outcome) values ('22222222-2222-2222-2222-222222222222', 'ask', 'ok');
  raise exception 'FAIL staff inserted into another store';
exception when insufficient_privilege then raise notice 'staff refused on another store: ok';
end $$;
select 'staff: reads no rows' as check, count(*) = 0 as ok from ai_call;
select 'staff: count is the whole store A today (ok, failed, staff ok) = 3' as check,
       public.ai_calls_today('11111111-1111-1111-1111-111111111111') = 3 as ok;
select 'staff: asking for store B still gets store A' as check,
       public.ai_calls_today('22222222-2222-2222-2222-222222222222') = 3 as ok;
reset role;

-- Manager of store A: money role, but not owner.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000c', false) is not null as manager_a;
set role authenticated;
select 'manager: reads no rows' as check, count(*) = 0 as ok from ai_call;
reset role;

-- Owner of store A.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', false) is not null as owner_a;
set role authenticated;
select 'owner A: reads all 5 store A rows, none of store B' as check,
       count(*) = 5 and bool_and(store_id = '11111111-1111-1111-1111-111111111111') as ok from ai_call;
with u as (update ai_call set outcome = 'ok' where outcome = 'failed' returning 1) select 'owner: cannot update' as check, count(*) = 0 as ok from u;
with d as (delete from ai_call returning 1) select 'owner: cannot delete' as check, count(*) = 0 as ok from d;
reset role;

-- Owner of store B sees only B.
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000a', false) is not null as owner_b;
set role authenticated;
select 'owner B: reads only store B' as check, count(*) = 1 as ok from ai_call;
reset role;

-- Anonymous: no execute on the count once login is on.
select set_config('request.jwt.claim.sub', '', false) is not null as anon;
set role anon;
do $$ begin
  perform public.ai_calls_today('11111111-1111-1111-1111-111111111111');
  raise exception 'FAIL anon could count';
exception when insufficient_privilege then raise notice 'anon refused execute: ok';
end $$;
select 'anon: reads no rows' as check, count(*) = 0 as ok from ai_call;
reset role;
