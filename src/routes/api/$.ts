import { createFileRoute } from "@tanstack/react-router";

// All JSON API endpoints live in src/server/api.ts; this just hands requests to it.
// The server code is imported lazily so it never ends up in the browser bundle.
const handle = async ({ request }: { request: Request }) => {
  const { handleApi } = await import("../../server/api");
  return handleApi(request);
};

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
