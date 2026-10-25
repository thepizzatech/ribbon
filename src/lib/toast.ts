import { create } from "zustand";

type ToastState = { id: number; message: string | null };

export const useToast = create<ToastState>(() => ({ id: 0, message: null }));

let timer: ReturnType<typeof setTimeout> | undefined;

/** Show a short black confirmation at the bottom of the screen. */
export function toast(message: string, ms = 2800) {
  if (timer) clearTimeout(timer);
  useToast.setState((state) => ({ id: state.id + 1, message }));
  timer = setTimeout(() => useToast.setState({ message: null }), ms);
}
