// Open the database (and run migrations) when the production server boots, so a
// bad DATA_DIR fails loudly at startup instead of on the first request.
import { getDb } from "../../src/server/db.ts";

export default () => {
  try {
    getDb();
    console.log("[ribbon] database ready");
  } catch (error) {
    console.error("[ribbon] cannot open the database:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};
