import { create } from "zustand"

type UIState = {
  loading: boolean
  modal: string | null

  setLoading: (v: boolean) => void
  openModal: (name: string) => void
  closeModal: () => void
}

export const useUIStore = create<UIState>((set) => ({
  loading: false,
  modal: null,

  setLoading: (loading) => set({ loading }),
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null })
}))