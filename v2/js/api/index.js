// The only place the views get data from. With ?demo=1 (or no Supabase
// project configured) it is the invented demo data; otherwise the Supabase
// project from config.js. Both expose the same functions (api/core.js).
import { SUPABASE } from '../config.js';

const demo = new URLSearchParams(location.search).has('demo') || !SUPABASE.url;

export const api = demo
  ? (await import('./mock/index.js')).api
  : (await import('./supabase/index.js')).api;
