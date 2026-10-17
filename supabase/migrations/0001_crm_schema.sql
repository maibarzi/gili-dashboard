-- Gili CRM schema: salons, team, services, contacts/people, appointments,
-- messages, automation settings. All tables are shared by all salons; every
-- row carries salon_id and row level security limits each signed-in user to
-- the salons they are a member of.
--
-- Writers:
--   n8n (connects as postgres, bypasses RLS): appointments, messages,
--     contacts/people created by the bot, chat status.
--   Dashboard (signed-in user, RLS applies): owner edits people, contacts'
--     consent/do-not-contact, services, automation settings, queue decisions.
--
-- Phone numbers are stored as international digits without '+', e.g. 436641234567
-- (the format WhatsApp uses in wa_id).

begin;

-- ---------- helpers ----------

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- salons ----------

create table public.salons (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name                     text not null,
  address                  text,
  timezone                 text not null default 'Europe/Vienna',
  -- Meta phone_number_id: how n8n finds the salon for an incoming message
  whatsapp_phone_number_id text unique,
  calendar_id              text,
  review_url               text,
  -- Luxon weekday (1 = Monday … 7 = Sunday) → ["10:00","19:00"] or null when closed
  opening_hours            jsonb not null default '{}'::jsonb,
  slot_step_min            int not null default 15 check (slot_step_min > 0),
  buffer_min               int not null default 0 check (buffer_min >= 0),
  min_notice_min           int not null default 60 check (min_notice_min >= 0),
  special_rules            text,          -- free text added to the bot prompt
  active                   boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger salons_updated_at before update on public.salons
  for each row execute function public.set_updated_at();

-- ---------- team and access ----------

create table public.staff (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  name        text not null,
  calendar_id text,                       -- own calendar, if the salon uses one per stylist
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (id, salon_id)
);

create table public.memberships (
  user_id    uuid not null references auth.users(id) on delete cascade,
  salon_id   uuid not null references public.salons(id) on delete cascade,
  role       text not null check (role in ('owner', 'staff')),
  staff_id   uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, salon_id),
  foreign key (staff_id, salon_id) references public.staff(id, salon_id)
);
create index memberships_salon on public.memberships(salon_id);

-- Gili team members who can see every salon (support, onboarding).
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- security definer: the policies call these, and they must read memberships
-- without being subject to memberships' own policies.
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

create or replace function public.is_member(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or exists (select 1 from memberships where salon_id = target and user_id = auth.uid())
$$;

create or replace function public.is_owner(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or exists (select 1 from memberships where salon_id = target and user_id = auth.uid() and role = 'owner')
$$;

-- ---------- services ----------

create table public.services (
  id             uuid primary key default gen_random_uuid(),
  salon_id       uuid not null references public.salons(id) on delete cascade,
  name           text not null,
  price          numeric(8,2),
  price_from     boolean not null default false,    -- "ab €115"
  duration_min   int check (duration_min > 0),
  reinvite_weeks int check (reinvite_weeks between 1 and 52),  -- null = never invite back for this
  active         boolean not null default true,
  sort           int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (salon_id, name),
  unique (id, salon_id)
);
create trigger services_updated_at before update on public.services
  for each row execute function public.set_updated_at();

-- ---------- contacts and people ----------

-- A contact is one WhatsApp number: where messages go.
create table public.contacts (
  id               uuid primary key default gen_random_uuid(),
  salon_id         uuid not null references public.salons(id) on delete cascade,
  phone            text not null check (phone ~ '^[1-9][0-9]{7,14}$'),
  whatsapp_name    text,                 -- profile name WhatsApp sends, not necessarily the real name
  source           text not null check (source in ('bot', 'import', 'manual')),
  marketing_consent boolean not null default false,
  consent_at       timestamptz,
  consent_source   text,                 -- e.g. "Bei der Buchung zugestimmt", "Bestandskundin (TKG)"
  do_not_contact   boolean not null default false,
  dnc_reason       text,
  dnc_at           timestamptz,
  chat_status      text check (chat_status in ('open', 'booked', 'handoff', 'closed')),
  chat_status_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (salon_id, phone),
  unique (id, salon_id)
);
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

-- A person is someone who gets appointments. Usually one per contact; a
-- mother booking for her daughter is one contact with two people. A regular
-- without WhatsApp can be entered by hand with no contact.
create table public.people (
  id              uuid primary key default gen_random_uuid(),
  salon_id        uuid not null references public.salons(id) on delete cascade,
  contact_id      uuid,
  name            text not null check (length(trim(name)) > 0),
  source          text not null check (source in ('bot', 'import', 'manual')),
  invites_enabled boolean not null default true,
  reviews_enabled boolean not null default true,
  paused_until    date,
  note            text,
  merged_into     uuid,                  -- set when the owner merges two entries for the same person
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, salon_id),
  foreign key (contact_id, salon_id) references public.contacts(id, salon_id) on delete set null (contact_id),
  foreign key (merged_into, salon_id) references public.people(id, salon_id)
);
create index people_contact on public.people(contact_id);
create unique index people_name_per_contact on public.people(contact_id, lower(name)) where merged_into is null;
create trigger people_updated_at before update on public.people
  for each row execute function public.set_updated_at();

-- ---------- appointments ----------

create table public.appointments (
  id                uuid primary key default gen_random_uuid(),
  salon_id          uuid not null references public.salons(id) on delete cascade,
  person_id         uuid,
  staff_id          uuid,
  calendar_event_id text,
  title             text,                -- calendar summary as written
  starts_at         timestamptz not null,
  ends_at           timestamptz,
  status            text not null default 'booked' check (status in ('booked', 'cancelled', 'no_show')),
  source            text not null check (source in ('bot', 'reinvite', 'manual', 'import', 'calendar')),
  price             numeric(8,2),
  price_is_minimum  boolean not null default false,
  booked_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (salon_id, calendar_event_id),
  unique (id, salon_id),
  check (ends_at is null or ends_at > starts_at),
  foreign key (person_id, salon_id) references public.people(id, salon_id) on delete set null (person_id),
  foreign key (staff_id, salon_id) references public.staff(id, salon_id) on delete set null (staff_id)
);
create index appointments_salon_start on public.appointments(salon_id, starts_at);
create index appointments_person on public.appointments(person_id, starts_at);
create trigger appointments_updated_at before update on public.appointments
  for each row execute function public.set_updated_at();

-- One appointment can cover several services ("Komplettfarbe & Haarschnitt").
create table public.appointment_services (
  appointment_id uuid not null,
  salon_id       uuid not null,
  service_id     uuid,
  name           text not null,          -- as written in the calendar, kept even if the service is renamed
  price          numeric(8,2),
  primary key (appointment_id, name),
  foreign key (appointment_id, salon_id) references public.appointments(id, salon_id) on delete cascade,
  foreign key (service_id, salon_id) references public.services(id, salon_id) on delete set null (service_id)
);

-- ---------- messages ----------

create table public.messages (
  id                 uuid primary key default gen_random_uuid(),
  salon_id           uuid not null references public.salons(id) on delete cascade,
  contact_id         uuid not null,
  direction          text not null check (direction in ('in', 'out')),
  kind               text not null default 'chat' check (kind in ('chat', 'reinvite', 'followup', 'review', 'promo')),
  body               text not null,
  at                 timestamptz not null default now(),
  wa_message_id      text unique,        -- WhatsApp message id, prevents double inserts on retries
  status             text check (status in ('sent', 'delivered', 'read', 'failed')),
  result             text check (result in ('booked', 'replied', 'no_reply', 'opted_out')),
  person_ids         uuid[],             -- who an automated message was about
  ref_appointment_id uuid,
  queue_key          text,               -- the planned-message key this was sent for
  created_at         timestamptz not null default now(),
  foreign key (contact_id, salon_id) references public.contacts(id, salon_id) on delete cascade,
  foreign key (ref_appointment_id, salon_id) references public.appointments(id, salon_id) on delete set null (ref_appointment_id)
);
create index messages_contact_at on public.messages(contact_id, at);
create index messages_salon_kind_at on public.messages(salon_id, kind, at);

-- ---------- automation ----------

create table public.automation_settings (
  salon_id                 uuid primary key references public.salons(id) on delete cascade,
  approval_mode            text not null default 'manual' check (approval_mode in ('manual', 'auto')),
  send_days                int[] not null default '{2,3,4,5,6}',   -- Luxon weekdays, 1 = Monday
  send_from                time not null default '10:00',
  send_to                  time not null default '18:00',
  min_gap_days             int not null default 30 check (min_gap_days >= 1),
  reinvite_enabled         boolean not null default false,
  reinvite_per_service     boolean not null default true,
  reinvite_default_weeks   int not null default 6 check (reinvite_default_weeks between 1 and 52),
  followup_enabled         boolean not null default true,
  followup_days            int not null default 14 check (followup_days >= 1),
  review_enabled           boolean not null default false,
  review_delay_hours       int not null default 24 check (review_delay_hours >= 0),
  updated_at               timestamptz not null default now(),
  check (send_to > send_from),
  check (send_days <@ '{1,2,3,4,5,6,7}'::int[] and cardinality(send_days) > 0)
);
create trigger automation_settings_updated_at before update on public.automation_settings
  for each row execute function public.set_updated_at();

-- Approved WhatsApp templates. salon_id null = shared by all salons.
create table public.message_templates (
  id                 uuid primary key default gen_random_uuid(),
  salon_id           uuid references public.salons(id) on delete cascade,
  kind               text not null check (kind in ('reinvite', 'reinvite_multi', 'followup', 'review', 'promo')),
  language           text not null default 'de',
  body               text not null,      -- with {name}, {salon}, {link} placeholders
  meta_template_name text,
  meta_status        text check (meta_status in ('draft', 'pending', 'approved', 'rejected')),
  created_at         timestamptz not null default now()
);
create unique index message_templates_kind on public.message_templates(coalesce(salon_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, language);

-- Owner decisions on planned messages (approve / skip), by the message key the
-- planner computes, e.g. "reinvite:<person>:<appointment>:0".
create table public.queue_decisions (
  salon_id   uuid not null references public.salons(id) on delete cascade,
  queue_key  text not null,
  action     text not null check (action in ('approve', 'skip')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (salon_id, queue_key)
);

-- ---------- row level security ----------

alter table public.salons               enable row level security;
alter table public.staff                enable row level security;
alter table public.memberships          enable row level security;
alter table public.platform_admins      enable row level security;
alter table public.services             enable row level security;
alter table public.contacts             enable row level security;
alter table public.people               enable row level security;
alter table public.appointments         enable row level security;
alter table public.appointment_services enable row level security;
alter table public.messages             enable row level security;
alter table public.automation_settings  enable row level security;
alter table public.message_templates    enable row level security;
alter table public.queue_decisions      enable row level security;

-- Nothing for anonymous visitors. Signed-in users get only what is granted
-- below, and RLS narrows it to their salons.
revoke all on public.salons, public.staff, public.memberships, public.platform_admins, public.services,
  public.contacts, public.people, public.appointments, public.appointment_services, public.messages,
  public.automation_settings, public.message_templates, public.queue_decisions from anon, authenticated;

grant select on public.salons, public.staff, public.memberships, public.services, public.contacts,
  public.people, public.appointments, public.appointment_services, public.messages,
  public.automation_settings, public.message_templates, public.queue_decisions to authenticated;

-- Column-level: what the dashboard may change. Everything else (phone numbers,
-- calendar ids, WhatsApp routing, appointments, messages) only n8n writes.
grant update (review_url, special_rules) on public.salons to authenticated;
grant insert (salon_id, name, price, price_from, duration_min, reinvite_weeks, active, sort),
      update (name, price, price_from, duration_min, reinvite_weeks, active, sort) on public.services to authenticated;
grant insert (salon_id, phone, whatsapp_name, source, marketing_consent, consent_at, consent_source),
      update (marketing_consent, consent_at, consent_source, do_not_contact, dnc_reason, dnc_at) on public.contacts to authenticated;
grant insert (salon_id, contact_id, name, source, invites_enabled, reviews_enabled, paused_until, note),
      update (contact_id, name, invites_enabled, reviews_enabled, paused_until, note, merged_into) on public.people to authenticated;
grant insert, update (approval_mode, send_days, send_from, send_to, min_gap_days, reinvite_enabled,
      reinvite_per_service, reinvite_default_weeks, followup_enabled, followup_days, review_enabled,
      review_delay_hours) on public.automation_settings to authenticated;
grant insert, update, delete on public.queue_decisions to authenticated;

-- Read: any member of the salon.
create policy member_read on public.salons               for select to authenticated using (is_member(id));
create policy member_read on public.staff                for select to authenticated using (is_member(salon_id));
create policy member_read on public.services             for select to authenticated using (is_member(salon_id));
create policy member_read on public.contacts             for select to authenticated using (is_member(salon_id));
create policy member_read on public.people               for select to authenticated using (is_member(salon_id));
create policy member_read on public.appointments         for select to authenticated using (is_member(salon_id));
create policy member_read on public.appointment_services for select to authenticated using (is_member(salon_id));
create policy member_read on public.messages             for select to authenticated using (is_member(salon_id));
create policy member_read on public.automation_settings  for select to authenticated using (is_member(salon_id));
create policy member_read on public.queue_decisions      for select to authenticated using (is_member(salon_id));
create policy member_read on public.message_templates    for select to authenticated using (salon_id is null or is_member(salon_id));
-- Memberships: see your own, owners see their salon's team.
create policy own_or_team on public.memberships for select to authenticated
  using (user_id = auth.uid() or is_owner(salon_id));

-- Write: owners only, and only rows of their own salon.
create policy owner_update on public.salons for update to authenticated using (is_owner(id)) with check (is_owner(id));
create policy owner_insert on public.services for insert to authenticated with check (is_owner(salon_id));
create policy owner_update on public.services for update to authenticated using (is_owner(salon_id)) with check (is_owner(salon_id));
create policy owner_insert on public.contacts for insert to authenticated with check (is_owner(salon_id) and source in ('manual', 'import'));
create policy owner_update on public.contacts for update to authenticated using (is_owner(salon_id)) with check (is_owner(salon_id));
create policy owner_insert on public.people for insert to authenticated with check (is_owner(salon_id) and source in ('manual', 'import'));
create policy owner_update on public.people for update to authenticated using (is_owner(salon_id)) with check (is_owner(salon_id));
create policy owner_insert on public.automation_settings for insert to authenticated with check (is_owner(salon_id));
create policy owner_update on public.automation_settings for update to authenticated using (is_owner(salon_id)) with check (is_owner(salon_id));
create policy owner_write on public.queue_decisions for all to authenticated
  using (is_owner(salon_id)) with check (is_owner(salon_id) and decided_by = auth.uid());

commit;
