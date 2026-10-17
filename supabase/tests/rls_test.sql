-- Two salons, an owner and a staff member of salon A, an owner of salon B.
-- Each check raises an exception if access is wrong.
\set ON_ERROR_STOP on
\o /dev/null
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'owner-a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'owner-b@test'),
  ('00000000-0000-0000-0000-0000000000a5', 'staff-a@test');
insert into public.salons (id, slug, name) values
  ('10000000-0000-0000-0000-00000000000a', 'salon-a', 'Salon A'),
  ('10000000-0000-0000-0000-00000000000b', 'salon-b', 'Salon B');
insert into public.memberships values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'owner', null),
  ('00000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', 'staff', null),
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'owner', null);
insert into public.contacts (id, salon_id, phone, source) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '436641111111', 'bot'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '436642222222', 'bot');
insert into public.people (id, salon_id, contact_id, name, source) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Anna', 'bot'),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Berta', 'bot');
insert into public.messages (salon_id, contact_id, direction, body) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'in', 'Hallo A'),
  ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'in', 'Hallo B');

-- Cross-salon references are rejected by the database itself.
do $$ begin
  insert into public.people (salon_id, contact_id, name, source)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000b', 'Mix', 'bot');
  raise exception 'FAIL: person of salon A linked to contact of salon B';
exception when foreign_key_violation then raise notice 'ok: cross-salon link rejected';
end $$;

create function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin
  if not cond then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

-- ----- anonymous (public API key) -----
set role anon;
do $$ begin perform 1 from public.people; raise exception 'FAIL: anon read people';
exception when insufficient_privilege then raise notice 'ok: anon cannot read people'; end $$;
do $$ begin perform 1 from public.parisa_chat_histories; raise exception 'FAIL: anon read chat histories';
exception when insufficient_privilege then raise notice 'ok: anon cannot read existing chat histories'; end $$;
reset role;

-- ----- owner of salon A -----
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) from public.people) = 1, 'owner A sees only own people');
select pg_temp.check((select count(*) from public.messages) = 1, 'owner A sees only own messages');
select pg_temp.check((select count(*) from public.salons) = 1, 'owner A sees only own salon');
update public.people set invites_enabled = false where id = '30000000-0000-0000-0000-00000000000b';
reset role;
select pg_temp.check((select invites_enabled from public.people where id = '30000000-0000-0000-0000-00000000000b'), 'owner A cannot change salon B person');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.people set invites_enabled = false where id = '30000000-0000-0000-0000-00000000000a';
reset role;
select pg_temp.check(not (select invites_enabled from public.people where id = '30000000-0000-0000-0000-00000000000a'), 'owner A can change own person');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  insert into public.people (salon_id, name, source) values ('10000000-0000-0000-0000-00000000000b', 'Sneaky', 'manual');
  raise exception 'FAIL: owner A inserted into salon B';
exception when insufficient_privilege then raise notice 'ok: owner A cannot add people to salon B'; end $$;
insert into public.people (salon_id, name, source) values ('10000000-0000-0000-0000-00000000000a', 'Stammkundin ohne WhatsApp', 'manual');
select pg_temp.check((select count(*) from public.people) = 2, 'owner A can add a regular by hand');
do $$ begin
  update public.contacts set phone = '436649999999' where id = '20000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL: owner changed a phone number';
exception when insufficient_privilege then raise notice 'ok: owner cannot change phone numbers'; end $$;
do $$ begin
  insert into public.messages (salon_id, contact_id, direction, body)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'out', 'fake');
  raise exception 'FAIL: dashboard wrote a message';
exception when insufficient_privilege then raise notice 'ok: dashboard cannot write messages'; end $$;
do $$ begin perform 1 from public.parisa_chat_histories; raise exception 'FAIL: user read chat histories';
exception when insufficient_privilege then raise notice 'ok: signed-in user cannot read existing chat histories'; end $$;
reset role;

-- ----- staff of salon A -----
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
select pg_temp.check((select count(*) from public.people) = 2, 'staff A reads salon A people');
update public.people set note = 'staff edit' where id = '30000000-0000-0000-0000-00000000000a';
reset role;
select pg_temp.check((select note from public.people where id = '30000000-0000-0000-0000-00000000000a') is null, 'staff cannot edit people');

-- ----- owner of salon B -----
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from public.people) = 1 and (select name from public.people) = 'Berta', 'owner B sees only Berta');
select pg_temp.check((select count(*) from public.memberships) = 1, 'owner B sees only own team');
reset role;

-- ----- n8n (table owner) still reads the old tables -----
select pg_temp.check((select count(*) from public.parisa_chat_histories) = 1, 'n8n still reads chat histories');
\o
\echo ALL CHECKS PASSED
