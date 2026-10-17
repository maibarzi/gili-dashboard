-- Minimal stand-in for what Supabase provides, so migrations can be tested
-- on plain Postgres: the API roles, auth.users and auth.uid().
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
-- Supabase grants everything on public tables to the API roles by default;
-- the migrations must take that back themselves.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
-- Pre-existing tables like the ones n8n created.
create table public.parisa_chat_histories (id serial primary key, session_id text, message jsonb);
insert into public.parisa_chat_histories (session_id, message) values ('436640000000', '{"content":"hallo"}');
create table public.leads (id serial primary key, name text);
