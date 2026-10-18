// The Supabase project the dashboard reads from. The publishable key is meant
// to be public: what each user can see and change is enforced by row level
// security in the database (supabase/migrations/0001_crm_schema.sql).
// Open the dashboard with ?demo=1 to use the invented demo data instead.
export const SUPABASE = {
  url: 'https://yejpdtlqcsceamwcyhqj.supabase.co',
  key: 'sb_publishable_tDZRrgtFZcYTJ9-rWDRARQ_YzzWvy8N',
  label: 'Testdatenbank (gili-test)',   // shown in the banner; empty for production
};
