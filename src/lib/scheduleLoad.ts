// The schedule upload's database side: who each schedule name is, which people to create, and
// which shifts are new. The import route (src/app/api/import/route.ts) calls planScheduleLoad,
// inserts the shift rows it returns, and shows scheduleLoadMessage. scripts/importexport-check
// runs the same functions against a fake database.
//
// Relative imports, not "@/lib/...", so the check can run the compiled files as they are.
// Kept out of importSchedule.ts, which the seed script loads with node's type stripping and
// so must stay free of imports.

import { mapScheduleNames, type ScheduleParse } from "./importSchedule";
import { fetchAllByKey } from "./exportPaging";

export type ScheduleShiftRow = {
  employee_id: string;
  department_id: string | null;
  work_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  created_by: string | null;
};

export type SchedulePlan = {
  newEmployees: number;                      // created by this upload
  shiftRows: ScheduleShiftRow[];             // new shifts to insert
  skipped: number;                           // shifts already on file
  heldShifts: number;                        // shifts whose name needs a decision
  held: { name: string; message: string }[]; // the names, with the sentence for the owner
};

// db is typed any like the route's client: the installed supabase-js generics narrow .insert()
// to never[] otherwise. Creates employees (the only write); the caller inserts the shifts.
export async function planScheduleLoad(
  db: any,
  parsed: ScheduleParse,
  storeId: string,
  actorId: string | null
): Promise<SchedulePlan> {
  // Employees: this store's, not deleted, the same set as before. A read error stops the
  // import: an empty list would make every name look new and create everyone again.
  const readEmployees = async (): Promise<{ id: string; full_name: string }[]> => {
    const { data, error } = await db.from("employee").select("id, full_name").eq("store_id", storeId).is("voided_at", null);
    if (error) throw new Error(`employee: ${error.message}`);
    return (data as any[]) || [];
  };
  // Create only names that match nobody, then map again so the new people attach too. Names
  // that are shared or may be someone already in Staff stay held, and their shifts are skipped.
  let names = mapScheduleNames(await readEmployees(), parsed.employees);
  const newNames = names.newNames;
  if (newNames.length) {
    const rows = newNames.map((full_name) => ({ store_id: storeId, full_name, status: "active" }));
    const { error } = await db.from("employee").insert(rows);
    if (error) throw new Error(`employee: ${error.message}`);
    names = mapScheduleNames(await readEmployees(), parsed.employees);
  }

  // Dedupe shifts against what is already on file for these employees. Paged, because a
  // season of shifts passes the 1000-row cap and a capped read would load the rest twice.
  const empIds = [...new Set(names.ids.values())];
  const existingKeys = new Set<string>();
  if (empIds.length) {
    const ex = await fetchAllByKey<any>(
      () => db.from("shift").select("id, employee_id, work_date, start_time, end_time").in("employee_id", empIds),
      "id"
    );
    for (const s of ex) {
      existingKeys.add(`${s.employee_id}|${s.work_date}|${String(s.start_time).slice(0, 5)}|${String(s.end_time).slice(0, 5)}`);
    }
  }

  const shiftRows: ScheduleShiftRow[] = [];
  let skipped = 0;
  let heldShifts = 0;
  for (const s of parsed.shifts) {
    const empId = names.ids.get(s.employeeName);
    if (!empId) { heldShifts++; continue; }
    const key = `${empId}|${s.workDate}|${s.startTime}|${s.endTime}`;
    if (existingKeys.has(key)) { skipped++; continue; }
    existingKeys.add(key);
    shiftRows.push({
      employee_id: empId,
      department_id: s.departmentId,
      work_date: s.workDate,
      start_time: s.startTime,
      end_time: s.endTime,
      notes: s.departmentId ? null : s.departmentKey,
      created_by: actorId
    });
  }
  return { newEmployees: newNames.length, shiftRows, skipped, heldShifts, held: names.held };
}

// The sentence the import screen shows after a schedule upload.
export function scheduleLoadMessage(plan: SchedulePlan, insertedShifts: number, weeks: number): string {
  const h = plan.heldShifts;
  return (
    `Loaded ${plan.newEmployees} new employees and ${insertedShifts} shifts across ${weeks} weeks. Skipped ${plan.skipped} shifts already on file.` +
    (h ? ` ${h} shift${h === 1 ? " was" : "s were"} not loaded. ${plan.held.map((x) => x.message).join(" ")} Then upload the same file again.` : "")
  );
}
