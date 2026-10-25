// Start the scheduled-backup timer when the production server boots.
import { getDb } from "../../src/server/db.ts";
import { startBackupScheduler } from "../../src/server/backup.ts";

export default () => {
  try {
    startBackupScheduler(getDb());
  } catch (error) {
    console.error("[ribbon] could not start scheduled backups:", error instanceof Error ? error.message : error);
  }
};
