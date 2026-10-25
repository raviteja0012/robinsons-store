-- After ai_call.sql runs again on an enforced database (it runs on every merge to main).
\set ON_ERROR_STOP on
select 'rerun: no dev_all recreated' as check, count(*) = 0 as ok
  from pg_policies where tablename = 'ai_call' and policyname = 'dev_all';
select 'rerun: owner_read intact' as check, count(*) = 1 as ok from pg_policies where tablename = 'ai_call';
select 'rerun: anon has no execute on either function' as check,
       not has_function_privilege('anon', 'public.ai_call_begin(uuid, text, text, integer)', 'execute')
       and not has_function_privilege('anon', 'public.ai_call_finish(uuid, text, text, text, integer, integer, integer, integer, integer)', 'execute') as ok;
select 'rerun: authenticated keeps execute on both' as check,
       has_function_privilege('authenticated', 'public.ai_call_begin(uuid, text, text, integer)', 'execute')
       and has_function_privilege('authenticated', 'public.ai_call_finish(uuid, text, text, text, integer, integer, integer, integer, integer)', 'execute') as ok;
