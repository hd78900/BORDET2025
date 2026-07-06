import { create } from 'zustand';
import { AuthState } from '../types';

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAdmin: false,
  accessibleBots: [],
  initializing: true,
  setUser: (user) => set({ user }),
  setIsAdmin: (isAdmin) => set({ isAdmin }),
  setAccessibleBots: (bots) => set({ accessibleBots: bots }),
  setInitializing: (v) => set({ initializing: v }),
}));