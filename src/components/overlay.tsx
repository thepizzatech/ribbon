import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Direction } from "@/lib/gifts/model";

export type Overlay =
  | { type: "none" }
  | {
      type: "gift";
      id: string | null;
      direction?: Direction;
      giverId?: string;
      receiverId?: string;
    }
  | { type: "person"; id: string | null };

type OverlayApi = {
  overlay: Overlay;
  open: (overlay: Overlay) => void;
  close: () => void;
};

const OverlayContext = createContext<OverlayApi | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [overlay, setOverlay] = useState<Overlay>({ type: "none" });

  const api = useMemo<OverlayApi>(
    () => ({
      overlay,
      open: setOverlay,
      close: () => setOverlay({ type: "none" }),
    }),
    [overlay],
  );

  return <OverlayContext.Provider value={api}>{children}</OverlayContext.Provider>;
}

export function useOverlay() {
  const value = useContext(OverlayContext);
  if (!value) throw new Error("Overlay is missing");
  return value;
}
