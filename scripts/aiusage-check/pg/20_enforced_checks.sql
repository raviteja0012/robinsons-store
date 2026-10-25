-- Enforced mode (after auth_setup.sql): owner reads, members write only through the two
-- functions, which stay on the caller's store whatever id is passed.
\set ON_ERROR_STOP on
select 'dev_all gone from ai_call' as check, count(*) = 0 as ok
  from pg_policies where tablename = 'ai_call' and policyname = 'dev_all';
select 'only the owner_read policy' as check,
       string_agg(policyname || ':' || cmd, ',') = 'owner_read:SELECT' as ok
  from pg_policies where tablename = 'ai_call';
select 'members linked' as check, count(*) = 4 as ok from app_user where auth_id is not null;

-- Staff of store A.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000b', false) is not null as staff_a;
set role authenticated;
do $$ begin
  insert into ai_call (store_id, route, outcome) values ('11111111-1111-1111-1111-111111111111', 'ask', 'ok');
  raise exception 'FAIL staff wrote the table directly';
exception when insufficient_privilege then raise notice 'staff cannot write the table directly: ok';
end $$;
select (public.ai_call_begin('22222222-2222-2222-2222-222222222222', 'extract', 'claude-sonnet-5', 100))->>'id' as staff_id \gset
select public.ai_call_finish(:'staff_id', 'ok', null, null, 10, 2, null, null, 900);
select 'staff: reads no rows' as check, count(*) = 0 as ok from ai_call;
select (public.ai_call_begin('11111111-1111-1111-1111-111111111111', 'ask', 'claude-sonnet-5', 100))->>'id' as pending_id \gset
reset role;
select 'staff reservation landed on store A, not the store B id passed' as check,
       store_id = '11111111-1111-1111-1111-111111111111' and outcome = 'ok' and input_tokens = 10 as ok
  from ai_call where id = :'staff_id';

-- Staff at the cap: the count is the whole store's, which staff cannot read.
select count(*) as used_a from ai_call
 where store_id = '11111111-1111-1111-1111-111111111111' and outcome <> 'capped'
   and created_at >= date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto' \gset
set role authenticated;
select 'staff: refused at the store cap' as check,
       (public.ai_call_begin('11111111-1111-1111-1111-111111111111', 'ask', 'claude-sonnet-5', :used_a))->>'allowed' = 'false' as ok;
reset role;

-- Owner of store B cannot finish store A's pending row.
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000a', false) is not null as owner_b;
set role authenticated;
select public.ai_call_finish(:'pending_id', 'failed', null, 'upstream', null, null, null, null, 1);
select 'owner B: reads only store B' as check,
       count(*) >= 1 and bool_and(store_id = '22222222-2222-2222-2222-222222222222') as ok from ai_call;
reset role;
select 'store A pending row untouched by store B' as check, outcome = 'pending' as ok from ai_call where id = :'pending_id';

-- Manager of store A: money role, but not owner.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000c', false) is not null as manager_a;
set role authenticated;
select 'manager: reads no rows' as check, count(*) = 0 as ok from ai_call;
reset role;

-- Owner of store A.
select count(*) as rows_a from ai_call where store_id = '11111111-1111-1111-1111-111111111111' \gset
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', false) is not null as owner_a;
set role authenticated;
select 'owner A: reads every store A row, none of store B' as check,
       count(*) = :rows_a and bool_and(store_id = '11111111-1111-1111-1111-111111111111') as ok from ai_call;
with u as (update ai_call set outcome = 'capped' where outcome <> 'capped' returning 1) select 'owner: cannot update' as check, count(*) = 0 as ok from u;
with d as (delete from ai_call returning 1) select 'owner: cannot delete' as check, count(*) = 0 as ok from d;
reset role;

-- Anonymous: no execute once login is on, and no rows.
select set_config('request.jwt.claim.sub', '', false) is not null as anon;
set role anon;
do $$ begin
  perform public.ai_call_begin('11111111-1111-1111-1111-111111111111', 'ask', 'm', 100);
  raise exception 'FAIL anon could reserve';
exception when insufficient_privilege then raise notice 'anon refused execute: ok';
end $$;
select 'anon: reads no rows' as check, count(*) = 0 as ok from ai_call;
reset role;
