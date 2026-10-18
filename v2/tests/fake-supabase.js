// Stand-in for @supabase/supabase-js in browser tests: answers queries from
// JSON table dumps served at /__dump/<table>.json and records writes in
// window.__writes. Supports only what api/supabase/index.js uses.
const tables = {};
const load = async t => (tables[t] ||= await (await fetch(`/__dump/${t}.json`)).json());
window.__writes = [];
const USER = { id: '00000000-0000-0000-0000-0000000000aa', email: 'mai@test' };

class Query {
  constructor(t) { this.t = t; this.filters = []; this.op = 'select'; this.span = null; }
  select() { return this; }
  eq(c, v) { this.filters.push(r => String(r[c]) === String(v)); return this; }
  in(c, vs) { this.filters.push(r => vs.includes(r[c])); return this; }
  or(expr) {
    const parts = expr.split(',').map(p => p.split('.'));
    this.filters.push(r => parts.some(([c, op, ...v]) => (op === 'is' ? r[c] === null : String(r[c]) === v.join('.'))));
    return this;
  }
  order() { return this; }
  range(a, b) { this.span = [a, b]; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  upsert(p) { this.op = 'upsert'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  then(ok, fail) { return this.run().then(ok, fail); }
  async run() {
    const rows = await load(this.t);
    const hit = rows.filter(r => this.filters.every(f => f(r)));
    if (this.op !== 'select') window.__writes.push({ table: this.t, op: this.op, payload: this.payload, rows: hit.length });
    if (this.op === 'select') return { data: this.span ? hit.slice(this.span[0], this.span[1] + 1) : hit, error: null };
    if (this.op === 'update') { hit.forEach(r => Object.assign(r, this.payload)); return { data: hit, error: null }; }
    if (this.op === 'delete') { tables[this.t] = rows.filter(r => !hit.includes(r)); return { data: hit, error: null }; }
    [].concat(this.payload).forEach(p => rows.push({ ...p }));
    return { data: [].concat(this.payload), error: null };
  }
}

export function createClient() {
  return {
    from: t => new Query(t),
    rpc: async () => ({ data: true, error: null }),   // is_platform_admin
    auth: {
      getSession: async () => ({ data: { session: sessionStorage.getItem('fake') ? { user: USER } : null } }),
      getUser: async () => ({ data: { user: USER } }),
      signInWithOtp: async ({ email, options }) => {
        window.__otp = { email, options };
        return { error: email === USER.email ? null : { message: 'Signups not allowed for otp' } };
      },
      verifyOtp: async ({ token }) => {
        if (token !== '123456') return { error: { message: 'Token has expired or is invalid' } };
        sessionStorage.setItem('fake', '1');
        return { error: null };
      },
      signOut: async () => { sessionStorage.removeItem('fake'); return { error: null }; },
    },
  };
}
