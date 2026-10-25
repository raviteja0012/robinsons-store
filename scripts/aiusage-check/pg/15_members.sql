-- Members and matching auth accounts, so auth_setup.sql section 4 links them by email.
\set ON_ERROR_STOP on
insert into app_user (id, store_id, full_name, role, email) values
  ('0000000a-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Owner A', 'owner', 'ownera@test'),
  ('0000000a-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Staff A', 'staff', 'staffa@test'),
  ('0000000a-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Manager A', 'manager', 'managera@test'),
  ('0000000b-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'Owner B', 'owner', 'ownerb@test');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ownera@test'),
  ('a0000000-0000-0000-0000-00000000000b', 'staffa@test'),
  ('a0000000-0000-0000-0000-00000000000c', 'managera@test'),
  ('b0000000-0000-0000-0000-00000000000a', 'ownerb@test');
