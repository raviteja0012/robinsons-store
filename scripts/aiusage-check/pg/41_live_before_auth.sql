-- After ai_call.sql, before auth_setup.sql is rerun: the cap and the log already work,
-- anonymous callers are already shut out, only the owner's read is still missing.
\set ON_ERROR_STOP on
select 'live: no policies yet' as check, count(*) = 0 as ok from pg_policies where tablename = 'ai_call';
select 'live: anon has no execute from the first run' as check,
       not has_function_privilege('anon', 'public.ai_call_begin(uuid, text, text, integer)', 'execute') as ok;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000b', false) is not null as staff_a;
set role authenticated;
select (public.ai_call_begin('11111111-1111-1111-1111-111111111111', 'ask', 'claude-sonnet-5', 1))->>'allowed' = 'true' as first_allowed \gset
select (public.ai_call_begin('11111111-1111-1111-1111-111111111111', 'ask', 'claude-sonnet-5', 1))->>'allowed' = 'false' as second_capped \gset
select 'live: staff call reserved, next one capped at 1' as check, :'first_allowed' = 't' and :'second_capped' = 't' as ok;
select 'live: staff reads nothing' as check, count(*) = 0 as ok from ai_call;
reset role;
