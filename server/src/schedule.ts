import type Database from "better-sqlite3";

type ScheduleRow = {
  id: number;
  user_id: number;
  envelope_id: number;
  day_of_month: number;
  type: "ebb" | "flow";
  amount_cents: number;
  note: string;
  last_run_month: string | null;
};

let scheduleRunnerBusy = false;

/**
 * Once per process tick: for each enabled schedule whose day matches today
 * (clamping day 29–31 to the last day of shorter months), insert a transaction
 * if we have not already run for this calendar month.
 */
export function runDueSchedules(db: Database.Database): void {
  if (scheduleRunnerBusy) return;
  scheduleRunnerBusy = true;
  try {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const todayDom = now.getDate();
    const lastDayOfMonth = new Date(y, m + 1, 0).getDate();
    const ym = `${y}-${String(m + 1).padStart(2, "0")}`;

    const rows = db
      .prepare(
        `SELECT s.id, s.user_id, s.envelope_id, s.day_of_month, s.type, s.amount_cents, s.note, s.last_run_month
         FROM scheduled_transactions s
         JOIN envelopes e ON e.id = s.envelope_id
         JOIN users u ON u.id = s.user_id
         WHERE s.enabled = 1
           AND e.household_id = u.household_id
           AND (
             (e.is_shared = 1 AND (u.is_admin = 1 OR e.user_id = s.user_id))
             OR (
               e.is_shared = 0
               AND (
                 (u.is_admin = 1 AND COALESCE(e.owner_user_id, e.user_id) = s.user_id)
                 OR (u.is_admin = 0 AND e.user_id = s.user_id)
               )
             )
           )`
      )
      .all() as ScheduleRow[];

    for (const row of rows) {
      const targetDay = Math.min(row.day_of_month, lastDayOfMonth);
      if (todayDom !== targetDay) continue;
      if (row.last_run_month === ym) continue;

      const signed = row.type === "flow" ? row.amount_cents : -row.amount_cents;

      const run = db.transaction(() => {
        const updated = db
          .prepare(
            `UPDATE scheduled_transactions
             SET last_run_month = ?
             WHERE id = ? AND (last_run_month IS NULL OR last_run_month != ?)`
          )
          .run(ym, row.id, ym);
        if (updated.changes !== 1) return;
        db.prepare(
          `INSERT INTO transactions (user_id, envelope_id, amount_cents, note)
           VALUES (?, ?, ?, ?)`
        ).run(row.user_id, row.envelope_id, signed, row.note);
      });
      run();
    }
  } finally {
    scheduleRunnerBusy = false;
  }
}
