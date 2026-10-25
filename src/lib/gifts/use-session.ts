import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/gifts/api";

/** The signed-in session, shared by every screen (React Query dedupes the request). */
export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: api.session, refetchOnWindowFocus: false });
}

/** The person in the ledger who is this login, if they said so. */
export function useMyPersonId(): string | null {
  return useSession().data?.user?.personId ?? null;
}
