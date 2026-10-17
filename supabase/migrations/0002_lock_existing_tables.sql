-- Turn on row level security for the tables that existed before the CRM
-- (bot memory, leads, onboarding). With RLS on and no policies, the public
-- API key (anon) and signed-in dashboard users can no longer read or write
-- them. n8n is not affected: it connects as the table owner (postgres),
-- which bypasses RLS.
--
-- BEFORE RUNNING: check that nothing writes to these tables with the public
-- key, e.g. the onboarding form or the landing page saving leads through
-- supabase-js. Those would stop working. Search their code for the Supabase
-- URL / anon key first. Tables that must stay writable from a public form
-- need their own narrow insert-only policy instead.

begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'chabad_chat_histories', 'chabad_owner_chat_histories', 'flore_chat_histories',
    'florence_demo_chat_histories', 'gili_chat_histories', 'gili_owner_memory', 'parisa_chat_histories',
    'message_buffer', 'customer_migration_contacts',
    'leads', 'leads_es',
    'client_onboarding', 'onboarding_answer_events', 'onboarding_media', 'onboarding_raw_messages',
    'onboarding_setup_queue'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    else
      raise notice 'table % not found, skipped', t;
    end if;
  end loop;
end $$;

commit;
