import { create } from 'zustand';

// UI-only flag: true while a queue-processing mutation is in flight, so item
// queries know to poll for live status updates. Never holds server data.
interface QueueState {
  processing: boolean;
  setProcessing: (processing: boolean) => void;
}

export const useQueueStore = create<QueueState>((set) => ({
  processing: false,
  setProcessing: (processing) => set({ processing }),
}));
