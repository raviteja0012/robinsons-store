const { parseSchedule, mapScheduleNames } = require("./importSchedule.js");
const { fetchAllByKey, EXPORT_PAGE_SIZE } = require("./exportPaging.js");
let pass = 0, fail = 0;
const t = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  [" + d + "]" : ""}`); };

async function main() {
  // ---- Schedule names: a shift lands on one known person or is held back with a reason ----

  // One week on one sheet: the date row (Excel serials from 2026-06-01), the day-name row,
  // then a department row whose Monday and Tuesday cells hold the same shift.
  const week = (cell) => [{
    name: "Week 1",
    rows: [
      ["", 46174, 46175, 46176, 46177, 46178, 46179, 46180],
      ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      ["Hardware", cell, cell, null, null, null, null, null]
    ]
  }];
  const AMBIGUOUS = "Amy matches 2 employees. Rename one in Staff, or write the full name in the schedule.";
  const MAYBE = "Amy may be Amy Robinson. Rename one in Staff to match, or write the full name in the schedule.";

  // Two employees named Amy and a cell "8-6 Amy": neither Amy gets the shifts.
  const amyWeek = parseSchedule(week("8-6 Amy"), {});
  const twoAmys = mapScheduleNames([{ id: "e1", full_name: "Amy" }, { id: "e2", full_name: "Amy" }], amyWeek.employees);
  const attached = amyWeek.shifts.filter((s) => twoAmys.ids.has(s.employeeName));
  t("two Amys: the cell parses to two shifts", amyWeek.shifts.length === 2, String(amyWeek.shifts.length));
  t("two Amys: neither Amy gets a shift", attached.length === 0, attached.map((s) => twoAmys.ids.get(s.employeeName)).join(","));
  t("two Amys: no third Amy is created", twoAmys.newNames.length === 0, twoAmys.newNames.join(","));
  t("two Amys: says Amy matches 2 employees", twoAmys.held.length === 1 && twoAmys.held[0].message === AMBIGUOUS, JSON.stringify(twoAmys.held));
  // Case and spacing do not hide a duplicate.
  const spaced = mapScheduleNames([{ id: "e1", full_name: "amy" }, { id: "e2", full_name: " Amy " }], ["Amy"]);
  t("two Amys spelled differently in Staff still count as 2", !spaced.ids.has("Amy") && spaced.held.length === 1);

  // "Amy" beside only "Amy Robinson": reported, nobody created, nothing attached.
  const robinson = mapScheduleNames([{ id: "e3", full_name: "Amy Robinson" }], ["Amy"]);
  t("Amy beside Amy Robinson creates no employee", robinson.newNames.length === 0, robinson.newNames.join(","));
  t("Amy beside Amy Robinson attaches nothing", !robinson.ids.has("Amy"));
  t("Amy beside Amy Robinson is reported", robinson.held.length === 1 && robinson.held[0].message === MAYBE, JSON.stringify(robinson.held));
  const initial = mapScheduleNames([{ id: "e3", full_name: "Amy Robinson" }], ["Amy R."]);
  t("an initial (Amy R.) is reported, not created", initial.newNames.length === 0 && initial.held.length === 1);
  const twoMaybes = mapScheduleNames([{ id: "e3", full_name: "Amy Robinson" }, { id: "e4", full_name: "Amy Chen" }], ["Amy"]);
  t("Amy beside two Amy surnames is reported with both", twoMaybes.newNames.length === 0 && /Amy Chen or Amy Robinson/.test(twoMaybes.held[0]?.message || ""), JSON.stringify(twoMaybes.held));

  // Unchanged from before: an exact unique match attaches, a genuinely new name is created.
  const exact = mapScheduleNames([{ id: "e3", full_name: "Amy Robinson" }, { id: "e5", full_name: "Campbell" }], ["amy robinson", "Campbell"]);
  t("exact match ignores case", exact.ids.get("amy robinson") === "e3");
  t("exact match attaches", exact.ids.get("Campbell") === "e5" && exact.held.length === 0 && exact.newNames.length === 0);
  const exactWins = mapScheduleNames([{ id: "e1", full_name: "Amy" }, { id: "e3", full_name: "Amy Robinson" }], ["Amy"]);
  t("one exact Amy wins over a longer name", exactWins.ids.get("Amy") === "e1" && exactWins.held.length === 0);
  const fresh = mapScheduleNames([{ id: "e3", full_name: "Amy Robinson" }], ["Esmerlda"]);
  t("a new name is created", fresh.newNames.length === 1 && fresh.newNames[0] === "Esmerlda" && fresh.held.length === 0);
  const jo = mapScheduleNames([{ id: "e6", full_name: "John Smith" }], ["Jo"]);
  t("Jo beside John Smith is a new person", jo.newNames.length === 1 && jo.held.length === 0);
  const twice = mapScheduleNames([], ["Amy", "amy"]);
  t("one new person per spelling, not per capitalization", twice.newNames.length === 1, twice.newNames.join(","));
  const afterInsert = mapScheduleNames([{ id: "n1", full_name: "Amy" }], ["Amy", "amy"]);
  t("both capitalizations attach to the one created", afterInsert.ids.get("Amy") === "n1" && afterInsert.ids.get("amy") === "n1");

  // ---- Export paging: every row that existed at the start comes out exactly once ----

  const ids = Array.from({ length: 1500 }, (_, i) => `id-${String(i + 1).padStart(4, "0")}`);

  // A fake table with just the query-builder calls the helper and the old offset loop use.
  // betweenPages[n] runs against the live rows just before request n is answered, which is
  // when somebody else's insert or delete lands while the export is mid-way.
  function fakeTable(rows, betweenPages = {}) {
    let request = 0;
    const seen = [];
    const select = () => {
      const q = { filters: [], order: null, limit: null, range: null };
      const b = {
        eq(c, v) { q.filters.push((r) => r[c] === v); return b; },
        gt(c, v) { q.filters.push((r) => r[c] > v); return b; },
        order(c, o) { q.order = { c, dir: o && o.ascending === false ? -1 : 1 }; return b; },
        limit(n) { q.limit = n; return b; },
        range(a, z) { q.range = [a, z]; return b; },
        then(ok, bad) {
          const n = request++;
          if (betweenPages[n]) betweenPages[n](rows);
          seen.push(q);
          let out = rows.filter((r) => q.filters.every((f) => f(r)));
          if (q.order) out.sort((x, y) => (x[q.order.c] < y[q.order.c] ? -1 : x[q.order.c] > y[q.order.c] ? 1 : 0) * q.order.dir);
          if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
          if (q.limit != null) out = out.slice(0, q.limit);
          return Promise.resolve({ data: out.map((r) => ({ ...r })), error: null }).then(ok, bad);
        }
      };
      return b;
    };
    return { select, seen };
  }
  // The loop the export used before: offset ranges over ORDER BY id.
  async function offsetPaging(select) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await select().order("id").range(from, from + 999);
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }
  const counts = (rows) => { const m = new Map(); for (const r of rows) m.set(r.id, (m.get(r.id) || 0) + 1); return m; };
  const eachOnce = (rows, want) => { const m = counts(rows); return want.every((id) => m.get(id) === 1); };
  const repeats = (rows) => [...counts(rows)].filter(([, n]) => n > 1).map(([id]) => id);

  // Somebody adds a row that sorts before the cursor while the export is between pages.
  const insertEarly = { 1: (rows) => rows.push({ id: "id-0500x" }) };
  const keysetIns = fakeTable(ids.map((id) => ({ id })), insertEarly);
  const keysetGot = await fetchAllByKey(keysetIns.select, "id");
  t("insert between pages: keyset returns every pre-existing id exactly once", eachOnce(keysetGot, ids), `repeats ${repeats(keysetGot).join(",") || "none"}`);
  const offsetIns = await offsetPaging(fakeTable(ids.map((id) => ({ id })), insertEarly).select);
  t("insert between pages: offset paging repeats one (the bug this replaces)", repeats(offsetIns).length === 1, repeats(offsetIns).join(","));

  // Somebody deletes a shift (a hard delete) that was already exported, between pages.
  const deleteEarly = { 1: (rows) => rows.splice(rows.findIndex((r) => r.id === "id-0010"), 1) };
  const keysetDel = await fetchAllByKey(fakeTable(ids.map((id) => ({ id })), deleteEarly).select, "id");
  t("delete between pages: keyset drops no other row", eachOnce(keysetDel, ids), `${keysetDel.length} rows`);
  const offsetDel = await offsetPaging(fakeTable(ids.map((id) => ({ id })), deleteEarly).select);
  t("delete between pages: offset paging drops one (the bug this replaces)", offsetDel.length === 1499 && !counts(offsetDel).has("id-1001"), `${offsetDel.length} rows`);

  // Every page keeps the caller's filter, so page two never reaches another store.
  const mixed = fakeTable([...ids.map((id) => ({ id, store_id: "s1" })), ...ids.map((id) => ({ id: id + "b", store_id: "s2" }))]);
  const s1 = await fetchAllByKey(() => mixed.select().eq("store_id", "s1"), "id");
  t("every page keeps the store filter", s1.length === 1500 && s1.every((r) => r.store_id === "s1"), `${s1.length} rows`);
  t("pages are ordered on the key, ascending, 1000 at a time",
    EXPORT_PAGE_SIZE === 1000 && mixed.seen.every((q) => q.order && q.order.c === "id" && q.order.dir === 1 && q.limit === 1000 && !q.range));

  // A short page ends it: 1000 rows takes a second (empty) request, 999 takes one.
  const full = fakeTable(ids.slice(0, 1000).map((id) => ({ id })));
  t("exactly one full page asks once more and stops", (await fetchAllByKey(full.select, "id")).length === 1000 && full.seen.length === 2);
  const short = fakeTable(ids.slice(0, 999).map((id) => ({ id })));
  t("a short first page stops at once", (await fetchAllByKey(short.select, "id")).length === 999 && short.seen.length === 1);
  const none = fakeTable([]);
  t("an empty table returns nothing", (await fetchAllByKey(none.select, "id")).length === 0 && none.seen.length === 1);

  // A database error fails the export instead of returning a short workbook.
  const broken = () => { const b = { gt: () => b, order: () => b, limit: () => b, then: (ok, bad) => Promise.resolve({ data: null, error: { message: "boom" } }).then(ok, bad) }; return b; };
  let threw = "";
  try { await fetchAllByKey(broken, "id"); } catch (e) { threw = e.message; }
  t("a database error throws", threw === "boom", threw);
  // Rows without the key cannot be paged; that fails loudly instead of looping forever.
  let noKey = "";
  try { await fetchAllByKey(fakeTable(ids.map((id) => ({ ref: id }))).select, "id"); } catch (e) { noKey = e.message; }
  t("rows missing the key throw instead of looping", /id/.test(noKey), noKey);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
