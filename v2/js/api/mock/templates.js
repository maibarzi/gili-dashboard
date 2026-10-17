// WhatsApp message templates. Outside the 24h window Meta only allows
// pre-approved templates, so the text is fixed and only the {placeholders} vary.
// In production these live in the backend together with their Meta template ids.

export const TEMPLATES = {
  reinvite: 'Hallo {name}, wir haben dich schon eine Weile nicht gesehen und würden uns freuen, dich wieder bei {salon} begrüßen zu dürfen. Möchtest du einen neuen Termin? Antworte einfach auf diese Nachricht. 🌸',
  followup: 'Hallo {name}, nur eine kurze Erinnerung: Bei {salon} sind in den nächsten Tagen noch Termine frei. Sollen wir dir einen reservieren?',
  review: 'Hallo {name}, danke für deinen Besuch bei {salon}. Wenn du zufrieden warst, würden wir uns sehr über eine kurze Bewertung freuen: {link}',
};

export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}
