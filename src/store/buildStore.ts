import { create } from 'zustand';
import type { LocalBuildStatus } from '../lib/db';

interface LiveBuildState {
  status: LocalBuildStatus;
  stage: string;
}

interface BuildStoreState {
  live: Record<string, LiveBuildState>;
  setLive: (buildId: string, state: LiveBuildState) => void;
  clearLive: (buildId: string) => void;
}

export const useBuildStore = create<BuildStoreState>((set) => ({
  live: {},
  setLive: (buildId, state) =>
    set((prev) => ({ live: { ...prev.live, [buildId]: state } })),
  clearLive: (buildId) =>
    set((prev) => {
      const { [buildId]: _, ...rest } = prev.live;
      return { live: rest };
    }),
}));
