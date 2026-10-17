-- Demo salon Florence (the sales demo bot). Values from its n8n workflows:
-- WhatsApp phone_number_id and calendar from "FLORE Bot", opening hours from
-- "FLORE Calendar Engine", prices from the bot prompt (Haarschnitt and
-- Balayage were added for the demo). Safe to re-run: existing rows are kept.

begin;

insert into public.salons (slug, name, address, whatsapp_phone_number_id, calendar_id, opening_hours,
  slot_step_min, buffer_min, min_notice_min)
values ('florence-demo', 'Florence Beauty Salon', 'Giligasse 8, 1010 Wien', '1083031034895956',
  'fdada6739af0894125bffb1aafb11bc6ba243b7ccdb03dc5c02df823f0a6bf38@group.calendar.google.com',
  '{"1": ["10:00", "19:00"], "2": ["10:00", "19:00"], "3": ["10:00", "19:00"], "4": ["10:00", "19:00"],
    "5": ["10:00", "19:00"], "6": ["10:00", "18:00"], "7": null}'::jsonb,
  15, 0, 60)
on conflict (slug) do nothing;

insert into public.services (salon_id, name, price, price_from, duration_min, reinvite_weeks, sort)
select s.id, v.name, v.price, v.price_from, v.duration_min, v.reinvite_weeks, v.sort
from public.salons s, (values
  ('Waschen, Schneiden & Föhnen (kurz)', 70, false, 60, 6, 0),
  ('Waschen, Schneiden & Föhnen (mittel)', 80, false, 60, 6, 1),
  ('Waschen, Schneiden & Föhnen (lang)', 100, false, 60, 6, 2),
  ('Spezielles Haarschnitt-Paket inkl. Pflege', 120, false, 70, 6, 3),
  ('Damenhaarschnitt (kurz/trocken)', 30, false, 30, 6, 4),
  ('Haarschnitt', 45, false, 45, 6, 5),
  ('Waschen, Schneiden & Föhnen (bis 10 Jahre)', 30, false, 30, 8, 6),
  ('Herrenhaarschnitt', 35, true, 60, 4, 7),
  ('Trockenhaarschnitt', 35, true, 60, 4, 8),
  ('Bart trimmen & rasieren', 35, true, 60, 4, 9),
  ('Ansatzblondierung & Föhnen (kurz)', 138, false, 135, 6, 10),
  ('Ansatzblondierung & Föhnen (mittel)', 148, false, 150, 6, 11),
  ('Ansatzblondierung & Föhnen (lang)', 158, false, 150, 6, 12),
  ('Ansatzblondierung & Föhnen (extralang)', 168, false, 150, 6, 13),
  ('Komplettfarbe', 115, true, 90, 6, 14),
  ('Strähnen ganzer Kopf', 115, true, 120, 8, 15),
  ('Blondierung', 115, true, 120, 8, 16),
  ('Balayage', 160, false, 180, 10, 17),
  ('Augenbrauen färben', 15, false, 15, 4, 18),
  ('Augenbrauen zupfen', 15, false, 15, 4, 19),
  ('Augenbrauen färben & zupfen', 25, false, 20, 4, 20),
  ('Augenbrauen & Wimpern färben', 25, false, 20, 4, 21),
  ('Augenbrauen färben & zupfen & Wimpern', 35, false, 20, 4, 22),
  ('Wimpern färben', 15, false, 15, 4, 23),
  ('Make-Up', 100, true, 60, null, 24),
  ('Haarkur', 30, false, 30, null, 25)
) as v(name, price, price_from, duration_min, reinvite_weeks, sort)
where s.slug = 'florence-demo'
on conflict (salon_id, name) do nothing;

-- Automations start switched off; the owner turns them on in the dashboard.
insert into public.automation_settings (salon_id)
select id from public.salons where slug = 'florence-demo'
on conflict (salon_id) do nothing;

-- Shared German templates (still need Meta approval before sending).
insert into public.message_templates (salon_id, kind, language, body, meta_status) values
  (null, 'reinvite', 'de', 'Hallo {name}, wir haben dich schon eine Weile nicht gesehen und würden uns freuen, dich wieder bei {salon} begrüßen zu dürfen. Möchtest du einen neuen Termin? Antworte einfach auf diese Nachricht. 🌸', 'draft'),
  (null, 'reinvite_multi', 'de', 'Hallo, wir haben {names} schon eine Weile nicht bei {salon} gesehen und würden uns freuen, euch wieder begrüßen zu dürfen. Sollen wir neue Termine vereinbaren? Antworte einfach auf diese Nachricht. 🌸', 'draft'),
  (null, 'followup', 'de', 'Hallo {name}, nur eine kurze Erinnerung: Bei {salon} sind in den nächsten Tagen noch Termine frei. Sollen wir dir einen reservieren?', 'draft'),
  (null, 'review', 'de', 'Hallo {name}, danke für deinen Besuch bei {salon}. Wenn du zufrieden warst, würden wir uns sehr über eine kurze Bewertung freuen: {link}', 'draft')
on conflict do nothing;

commit;
