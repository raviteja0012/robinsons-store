-- The live path: an enforced database that has never had ai_call. Drop it here; run.sh
-- then runs supabase/ai_call.sql, checks 41, reruns auth_setup.sql, and checks 30 again.
\set ON_ERROR_STOP on
drop function public.ai_calls_today(uuid);
drop table public.ai_call;
