-- After 20 simultaneous reservations against store D with a cap of 5 (pgbench, 20 clients).
\set ON_ERROR_STOP on
select 'burst: exactly 5 of 20 reserved' as check, count(*) = 5 as ok
  from ai_call where store_id = '44444444-4444-4444-4444-444444444444' and outcome = 'pending';
select 'burst: the other 15 recorded as capped' as check, count(*) = 15 as ok
  from ai_call where store_id = '44444444-4444-4444-4444-444444444444' and outcome = 'capped';
