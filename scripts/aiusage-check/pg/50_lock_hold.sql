-- Session one of the lock test: reserve store C's only slot, then hold the transaction open
-- for three seconds before committing. run.sh starts this in the background.
begin;
select public.ai_call_begin('33333333-3333-3333-3333-333333333333', 'ask', 'm', 1);
select pg_sleep(3);
commit;
