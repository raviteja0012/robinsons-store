-- After ai_call.sql runs again on an enforced database (it runs on every merge to main).
\set ON_ERROR_STOP on
select 'rerun: no dev_all recreated' as check, count(*) = 0 as ok
  from pg_policies where tablename = 'ai_call' and policyname = 'dev_all';
select 'rerun: policies intact' as check, count(*) = 2 as ok from pg_policies where tablename = 'ai_call';
select 'rerun: anon still has no execute' as check,
       not has_function_privilege('anon', 'public.ai_calls_today(uuid)', 'execute') as ok;
select 'rerun: authenticated keeps execute' as check,
       has_function_privilege('authenticated', 'public.ai_calls_today(uuid)', 'execute') as ok;
