/** What this sign-in may do, as the server sent it at sign-in. The server checks every request again; this only decides what to show. */
const MECHANIC = ["jobs_view", "jobs", "quotes", "vehicles", "bills_view", "bill", "job_stock", "stock_in", "stock_out", "item_add"];
let all = false;
let mine = new Set<string>();

export function setPermissions(roles: string[], permissions?: string[]) {
  all = roles.includes("ROLE_OWNER");
  // an older server (or practice mode) sends no list: an owner may do everything, anyone else what a mechanic always could
  mine = new Set(permissions ?? (all ? [] : MECHANIC));
}
export const can = (key: string) => all || mine.has(key);
export const canAny = (...keys: string[]) => keys.some(can);
