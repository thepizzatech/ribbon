// The core ledger endpoints: household, people, gifts, occasions, export and import.
import { parseBackupData } from "../lib/gifts/model.ts";
import { error, json, respond, type ApiCall } from "./http.ts";
import {
  addGift,
  addOccasion,
  addPerson,
  exportLedger,
  getLedger,
  removeGift,
  removeOccasion,
  removePerson,
  renameOccasion,
  replaceLedger,
  updateGift,
  updateHousehold,
  updatePerson,
} from "./ledger.ts";

export function ledgerHandler(c: ApiCall): Response | null {
  const { ctx, method, id, rest, body, resource } = c;
  if (rest.length > 0) return null;
  switch (resource) {
    case "ledger":
      if (method === "GET" && id === undefined) return json(getLedger(ctx));
      break;
    case "household":
      if (method === "PUT" && id === undefined) {
        const result = updateHousehold(ctx, (body ?? {}) as object);
        return result.ok ? json(getLedger(ctx)) : respond(result);
      }
      break;
    case "people":
      if (method === "GET" && id === undefined) return json({ people: getLedger(ctx).people });
      if ((method === "POST" || method === "PATCH") && c.body && typeof c.body === "object" && "shared" in c.body && !c.isOwner) {
        return error(403, "Only a household owner can share someone with a linked household.");
      }
      if (method === "POST" && id === undefined) return respond(addPerson(ctx, body), 201);
      if (method === "PATCH" && id !== undefined) return respond(updatePerson(ctx, id, body));
      if (method === "DELETE" && id !== undefined) return respond(removePerson(ctx, id));
      break;
    case "gifts":
      if (method === "GET" && id === undefined) return json({ gifts: getLedger(ctx).gifts });
      if (method === "POST" && id === undefined) return respond(addGift(ctx, body), 201);
      if (method === "PATCH" && id !== undefined) return respond(updateGift(ctx, id, body));
      if (method === "DELETE" && id !== undefined) return respond(removeGift(ctx, id));
      break;
    case "occasions":
      if (method === "GET" && id === undefined) return json({ occasions: getLedger(ctx).occasions });
      if (method === "POST" && id === undefined) return respond(addOccasion(ctx, body), 201);
      if (method === "PATCH" && id !== undefined) return respond(renameOccasion(ctx, id, body));
      if (method === "DELETE" && id !== undefined) return respond(removeOccasion(ctx, id));
      break;
    case "export":
      if (method === "GET" && id === undefined) {
        const response = json(exportLedger(ctx));
        response.headers.set("content-disposition", 'attachment; filename="ribbon-ledger.json"');
        return response;
      }
      break;
    case "import":
      if (method === "POST" && id === undefined) {
        const record = (body ?? {}) as { demo?: unknown; demoDismissed?: unknown };
        const backup = parseBackupData(body);
        if (!backup) return error(400, "That file is not a Ribbon ledger.");
        if (!c.isOwner) {
          // Sharing people outward is an owner decision; a member's file can't change it.
          const was = new Map(getLedger(ctx).people.map((p) => [p.id, p.shared === true]));
          backup.people = backup.people.map((p) => ({ ...p, shared: was.get(p.id) ?? false }));
        }
        const result = replaceLedger(ctx, backup, {
          demo: record.demo === true,
          demoDismissed: record.demoDismissed !== false,
        });
        return result.ok ? json(getLedger(ctx)) : respond(result);
      }
      break;
    default:
      return null;
  }
  return null;
}
