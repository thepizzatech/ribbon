// Start the calendar refresh timer when the production server boots.
import { getDb } from "../../src/server/db.ts";
import { startCalendarScheduler } from "../../src/server/calendar-sync.ts";

export default () => {
  try {
    startCalendarScheduler(getDb());
  } catch (error) {
    console.error("[ribbon] could not start calendar sync:", error instanceof Error ? error.message : error);
  }
};
