// Open the database (and run migrations) when the production server boots, so a
// bad DATA_DIR fails loudly at startup instead of on the first request.
import { allowPublicSetup, setupCode } from "../../src/server/config.ts";
import { getDb } from "../../src/server/db.ts";
import { userCount } from "../../src/server/users.ts";

export default () => {
  try {
    const db = getDb();
    console.log("[ribbon] database ready");
    if (userCount(db) === 0 && !setupCode()) {
      console.warn(
        allowPublicSetup()
          ? "[ribbon] WARNING: no owner exists yet and ALLOW_PUBLIC_SETUP is on: anyone who can reach this server can create the owner account. Finish setup now."
          : "[ribbon] no owner exists yet. Without SETUP_CODE the owner account can only be created from your home network. Set SETUP_CODE to create it from anywhere.",
      );
    }
  } catch (error) {
    console.error("[ribbon] cannot open the database:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};
