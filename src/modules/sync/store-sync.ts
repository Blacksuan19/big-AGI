import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { isBrowser } from '~/common/util/pwaUtils';

import type { SyncStatus } from './sync.types';

interface SyncState {
  supabaseUrl: string;
  supabaseAnonKey: string;
  syncKey: string;
  syncUserId: string | null;

  lastConversationSyncTime: number;
  lastBlobsSyncTime: number;
  lastStoresSyncTime: number;
  lastStoreSyncHashes: Record<string, string>;

  pendingChangedConversationIds: string[];
  pendingDeletedConversationIds: string[];

  syncStatus: SyncStatus;
  lastSyncError: string | null;
  lastSyncAt: number | null;
}

interface SyncActions {
  setSyncConfig: (config: Partial<Pick<SyncState, 'supabaseUrl' | 'supabaseAnonKey' | 'syncKey'>>) => void;
  setSyncUserId: (userId: string | null) => void;

  setLastConversationSyncTime: (t: number) => void;
  setLastBlobsSyncTime: (t: number) => void;
  setLastStoresSyncTime: (t: number) => void;
  setLastStoreSyncHashes: (hashes: Record<string, string>) => void;

  addPendingChangedConversations: (ids: string[]) => void;
  clearPendingChangedConversations: (ids: string[]) => void;
  addPendingDeletedConversations: (ids: string[]) => void;
  clearPendingDeletedConversations: (ids: string[]) => void;

  setSyncStatus: (status: SyncStatus, error?: string | null) => void;
  setLastSyncAt: (t: number) => void;

  resetSync: () => void;
}

export const useSyncStore = create<SyncState & SyncActions>()(
  persist(
    (set) => ({
      supabaseUrl: '',
      supabaseAnonKey: '',
      syncKey: '',
      syncUserId: null,
      lastConversationSyncTime: 0,
      lastBlobsSyncTime: 0,
      lastStoresSyncTime: 0,
      lastStoreSyncHashes: {},
      pendingChangedConversationIds: [],
      pendingDeletedConversationIds: [],

      syncStatus: 'idle',
      lastSyncError: null,
      lastSyncAt: null,

      setSyncConfig: (config) => set(config),
      setSyncUserId: (userId) => set({ syncUserId: userId }),

      setLastConversationSyncTime: (t) => set({ lastConversationSyncTime: t }),
      setLastBlobsSyncTime: (t) => set({ lastBlobsSyncTime: t }),
      setLastStoresSyncTime: (t) => set({ lastStoresSyncTime: t }),
      setLastStoreSyncHashes: (hashes) => set({ lastStoreSyncHashes: hashes }),

      addPendingChangedConversations: (ids) =>
        set((state) => ({
          pendingChangedConversationIds: [...new Set([...state.pendingChangedConversationIds, ...ids])],
        })),
      clearPendingChangedConversations: (ids) =>
        set((state) => ({
          pendingChangedConversationIds: state.pendingChangedConversationIds.filter((id) => !ids.includes(id)),
        })),
      addPendingDeletedConversations: (ids) =>
        set((state) => ({
          pendingDeletedConversationIds: [...new Set([...state.pendingDeletedConversationIds, ...ids])],
        })),
      clearPendingDeletedConversations: (ids) =>
        set((state) => ({
          pendingDeletedConversationIds: state.pendingDeletedConversationIds.filter((id) => !ids.includes(id)),
        })),

      setSyncStatus: (status, error = null) => set({ syncStatus: status, lastSyncError: error ?? null }),
      setLastSyncAt: (t) => set({ lastSyncAt: t }),

      resetSync: () =>
        set({
          supabaseUrl: '',
          supabaseAnonKey: '',
          syncKey: '',
          syncUserId: null,
          lastConversationSyncTime: 0,
          lastBlobsSyncTime: 0,
          lastStoresSyncTime: 0,
          lastStoreSyncHashes: {},
          pendingChangedConversationIds: [],
          pendingDeletedConversationIds: [],
          syncStatus: 'idle',
          lastSyncError: null,
          lastSyncAt: null,
        }),
    }),
    {
      name: 'app-sync',
      storage: isBrowser ? createJSONStorage(() => localStorage) : undefined,
      partialize: (state) => ({
        supabaseUrl: state.supabaseUrl,
        supabaseAnonKey: state.supabaseAnonKey,
        syncKey: state.syncKey,
        syncUserId: state.syncUserId,
        lastConversationSyncTime: state.lastConversationSyncTime,
        lastBlobsSyncTime: state.lastBlobsSyncTime,
        lastStoresSyncTime: state.lastStoresSyncTime,
        lastStoreSyncHashes: state.lastStoreSyncHashes,
        pendingChangedConversationIds: state.pendingChangedConversationIds,
        pendingDeletedConversationIds: state.pendingDeletedConversationIds,
      }),
    },
  ),
);

export function syncIsConfigured(): boolean {
  const { supabaseUrl, supabaseAnonKey, syncKey } = useSyncStore.getState();
  return !!(supabaseUrl && supabaseAnonKey && syncKey);
}
