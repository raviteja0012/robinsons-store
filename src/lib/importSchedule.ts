// Parse the store's weekly schedule workbook into employees and shifts.
//
// Shape of the workbook: one sheet per week. Within a sheet, a row of Excel-serial dates
// (Mon..Sun), a day-name row, a store-hours row, then one row per department whose cells read
// like "8-6 Amy" (time range + employee). A cell can hold more than one shift, e.g.
// "10-6 Esmerlda  10-8 Campbell". Times use the store clock: 1-7 mean PM, 8-12 mean AM/noon.
//
// Pure and server/script only (no React, no crypto, no Supabase). Used by the upload route
// (src/app/api/import/route.ts) and the loader (scripts/generate-seed-schedule.mjs).

export type ScheduleShift = {
  employeeName: string;
  departmentKey: string;   // normalized schedule department label
  departmentId: string | null; // our department id when it maps, else null
  workDate: string;        // yyyy-mm-dd
  startTime: string;       // HH:MM (24h)
  endTime: string;         // HH:MM (24h)
  raw: string;             // the original cell text, kept for the note
};

export type ScheduleParse = {
  employees: string[];          // distinct employee names
  shifts: ScheduleShift[];
  summary: { weeks: number; employees: number; shifts: number; unmatchedDepartments: string[]; firstDate: string | null; lastDate: string | null };
};

const pad = (n: number) => String(n).padStart(2, "0");

// Excel serial date -> yyyy-mm-dd (epoch 1899-12-30). Non-numbers return null.
function iso(v: any): string | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  const d = new Date(Math.round((v - 25569) * 86400 * 1000));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Store clock: hours 1-7 are afternoon (add 12), 8-12 are morning/noon as written.
function to24(h: number, m: number): string {
  let hh = h;
  if (hh >= 1 && hh <= 7) hh += 12;
  return `${pad(hh)}:${pad(m || 0)}`;
}

// Map a schedule department label to one of our department names, then to its id via deptMap
// (keys are our department names, lowercased). Unmapped labels (Checkout, Flyers) return null.
function resolveDept(raw: string, deptMap: Record<string, string>): { key: string; id: string | null } {
  const n = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const alias: Record<string, string> = {
    "front endcheckout": "checkout", "front end checkout": "checkout", "front end": "checkout", checkout: "checkout",
    "chips stand": "chip stand", "chip stand": "chip stand",
    "lakeside apparel": "clothing", apparel: "clothing", clothing: "clothing",
    "dry goods": "gifts", gifts: "gifts",
    flyers: "flyers",
    hardware: "hardware", grocery: "grocery", bakery: "bakery", produce: "produce", meat: "meat", "garden center": "garden center"
  };
  const key = alias[n] || n;
  return { key, id: deptMap[key] ?? null };
}

// Find all "time-range name" shift segments in one cell.
const SEG = /(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s+([A-Za-z][A-Za-z.&/ ]*?)(?=(?:\s+\d{1,2}\s*-)|\s*$)/g;

const WEEKDAY = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;

export function parseSchedule(
  sheets: { name: string; rows: any[][] }[],
  deptMap: Record<string, string>
): ScheduleParse {
  const shifts: ScheduleShift[] = [];
  const employees = new Set<string>();
  const unmatched = new Set<string>();
  const allDates: string[] = [];
  let weeks = 0;

  for (const sheet of sheets) {
    const rows = sheet.rows || [];
    // The date row is the first row with at least four numeric cells in columns 1..7.
    let dateRow = -1;
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      const nums = (rows[i] || []).slice(1, 8).filter((v) => typeof v === "number").length;
      if (nums >= 4) { dateRow = i; break; }
    }
    if (dateRow === -1) continue;
    const dates: (string | null)[] = [];
    for (let c = 1; c <= 7; c++) dates[c] = iso(rows[dateRow][c]);
    weeks++;

    for (let i = dateRow + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const label = r[0] == null ? "" : String(r[0]).trim();
      if (!label || WEEKDAY.test(label) || /^hours/i.test(label)) continue; // skip day/hours rows
      const dept = resolveDept(label, deptMap);
      if (dept.id === null && (dept.key === "checkout" || dept.key === "flyers" || !deptMap[dept.key])) {
        if (dept.key !== "checkout" && dept.key !== "flyers") unmatched.add(label);
      }
      for (let c = 1; c <= 7; c++) {
        const date = dates[c];
        const cell = r[c];
        if (!date || cell == null || String(cell).trim() === "") continue;
        const text = String(cell).trim();
        let m: RegExpExecArray | null;
        SEG.lastIndex = 0;
        while ((m = SEG.exec(text)) !== null) {
          const name = m[5].replace(/\s+/g, " ").trim();
          if (!name || name.length < 2) continue; // skip stray single letters (initials/typos)
          employees.add(name);
          shifts.push({
            employeeName: name,
            departmentKey: dept.key,
            departmentId: dept.id,
            workDate: date,
            startTime: to24(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0),
            endTime: to24(parseInt(m[3], 10), m[4] ? parseInt(m[4], 10) : 0),
            raw: text
          });
        }
      }
    }
    for (const d of dates) if (d) allDates.push(d);
  }

  allDates.sort();
  return {
    employees: [...employees].sort(),
    shifts,
    summary: {
      weeks,
      employees: employees.size,
      shifts: shifts.length,
      unmatchedDepartments: [...unmatched],
      firstDate: allDates[0] || null,
      lastDate: allDates[allDates.length - 1] || null
    }
  };
}

// Detect whether a workbook looks like the weekly schedule (vs the bookings ledger), so the
// upload route can pick the right parser. The schedule has day-name rows and time+name cells;
// the bookings ledger has a "Vendor" header and "Amount"/"Invoiced" columns.
export function looksLikeSchedule(sheets: { name: string; rows: any[][] }[]): boolean {
  for (const s of sheets.slice(0, 3)) {
    for (const row of (s.rows || []).slice(0, 4)) {
      const joined = (row || []).map((v) => (v == null ? "" : String(v))).join(" ").toLowerCase();
      if (/monday\s+tuesday|tuesday\s+wednesday/.test(joined)) return true;
    }
  }
  return false;
}

export type ScheduleNameMap = {
  ids: Map<string, string>;                  // schedule name as written -> employee id (one exact match)
  newNames: string[];                        // matches nobody: create these, one per spelling
  held: { name: string; message: string }[]; // shifts for these names are not loaded, with the reason
};

// Lowercase words, spaces collapsed, the dot after an initial dropped ("Amy R." reads "amy r").
const nameWords = (s: string) => String(s || "").toLowerCase().replace(/\./g, " ").split(/\s+/).filter(Boolean);

// Whether a schedule name could be a shorter way of writing a Staff full name. A lone first
// name must be the whole first word ("Amy" for "Amy Robinson", but "Jo" is not "John Smith");
// after that the last word may be an initial or a shortening ("Amy R." for "Amy Robinson").
function couldBe(short: string[], full: string[]): boolean {
  if (!short.length || short.length > full.length) return false;
  const last = short.length - 1;
  for (let i = 0; i < last; i++) if (short[i] !== full[i]) return false;
  return last === 0 ? short[0] === full[0] : full[last].startsWith(short[last]);
}

// Decide which employee each schedule name belongs to. A name that matches exactly one person
// attaches; a name that matches nobody, not even as a shortening, is a new person to create.
// Anything in between is held back with a sentence for the owner: a name two people share
// would otherwise land every shift on whichever row came last, and "Amy" beside "Amy Robinson"
// would otherwise create a second Amy with no pay rate.
//
// `employees` is the route's set: this store's employees that are not deleted (voided_at
// null). A deleted person is not matched, so a name only they carried counts as new.
export function mapScheduleNames(employees: { id: string; full_name: string }[], names: string[]): ScheduleNameMap {
  const staff = employees.map((e) => ({ id: e.id, fullName: String(e.full_name || "").trim(), words: nameWords(e.full_name) }));
  const ids = new Map<string, string>();
  const newNames: string[] = [];
  const held: { name: string; message: string }[] = [];
  const decided = new Set<string>();

  for (const name of names) {
    const words = nameWords(name);
    const key = words.join(" ");
    if (!key) continue;
    const exact = staff.filter((s) => s.words.join(" ") === key);
    if (exact.length === 1) {
      ids.set(name, exact[0].id);
      continue;
    }
    // One report and one new employee per name, however the schedule capitalizes it.
    if (decided.has(key)) continue;
    decided.add(key);
    if (exact.length > 1) {
      held.push({ name, message: `${name} matches ${exact.length} employees. Rename one in Staff, or write the full name in the schedule.` });
      continue;
    }
    const maybe = [...new Set(staff.filter((s) => couldBe(words, s.words)).map((s) => s.fullName))].sort();
    if (maybe.length) {
      const who = maybe.length === 1 ? maybe[0] : `${maybe.slice(0, -1).join(", ")} or ${maybe[maybe.length - 1]}`;
      held.push({ name, message: `${name} may be ${who}. Rename one in Staff to match, or write the full name in the schedule.` });
      continue;
    }
    newNames.push(name);
  }
  return { ids, newNames, held };
}
