-- Session two of the lock test, started a second after session one. Without the per-store
-- lock it would not see session one's uncommitted reservation and would also be allowed. With
-- it, it waits for session one to commit, then sees the slot taken.
\set ON_ERROR_STOP on
select clock_timestamp() as t0 \gset
select (public.ai_call_begin('33333333-3333-3333-3333-333333333333', 'ask', 'm', 1))->>'allowed' as allowed \gset
select 'lock: second caller waited for the first' as check, clock_timestamp() - :'t0'::timestamptz > interval '1.5 seconds' as ok;
select 'lock: second caller refused, slot already taken' as check, :'allowed' = 'false' as ok;
