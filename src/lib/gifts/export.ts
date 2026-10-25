import type { Ledger } from "@/lib/gifts/model";

/** Save the ledger on screen as a JSON file (same format as /api/export). */
export function downloadLedger(state: Pick<Ledger, "householdName" | "people" | "gifts" | "occasions">) {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          version: 1,
          householdName: state.householdName,
          people: state.people,
          gifts: state.gifts,
          occasions: state.occasions,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ribbon-ledger.json";
  link.click();
  URL.revokeObjectURL(url);
}
