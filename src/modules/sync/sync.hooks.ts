import * as React from 'react';

import { useChatStore } from '~/common/stores/chat/store-chats';
import { isBrowser } from '~/common/util/pwaUtils';
import { WindowFocusObserver } from '~/common/util/windowUtils';

import { useSyncStore } from './store-sync';
import { syncRegisterOrLogin } from './sync.auth';
import { getSyncClient } from './sync.client';
import { isApplyingRemoteConversationChanges } from './sync.operations';
import { performFullSync } from './sync.operations';
import type { SyncConversationMode } from './sync.types';

const WAKE_SYNC_DEDUPE_MS = 1_500;

function isConversationSyncable(conversation: ReturnType<typeof useChatStore.getState>['conversations'][number]): boolean {
  if (conversation._abortController)
    return false;

  return !conversation.messages.some((message) => message.pendingIncomplete);
}

export function useAutoSync() {
  const { supabaseUrl, supabaseAnonKey, syncKey, syncUserId, syncStatus, setSyncUserId, addPendingChangedConversations, addPendingDeletedConversations } = useSyncStore();

  const isReady = !!(supabaseUrl && supabaseAnonKey && syncKey && syncUserId);
  const needsResyncRef = React.useRef(false);
  const lastWakeSyncAtRef = React.useRef(0);
  const pendingResyncModeRef = React.useRef<SyncConversationMode>('dirty');

  const requestSync = React.useCallback((reason: 'chat-change' | 'visibility' | 'focus') => {
    const supabase = getSyncClient();
    const { syncUserId: userId, syncStatus } = useSyncStore.getState();
    if (!supabase || !userId) return;
    const conversationMode: SyncConversationMode = reason === 'chat-change' ? 'dirty' : 'full';

    if (reason !== 'chat-change') {
      const now = Date.now();
      if (now - lastWakeSyncAtRef.current < WAKE_SYNC_DEDUPE_MS) return;
      lastWakeSyncAtRef.current = now;
    }

    if (syncStatus === 'syncing') {
      if (conversationMode === 'full')
        pendingResyncModeRef.current = 'full';
      needsResyncRef.current = true;
      return;
    }

    performFullSync(supabase, userId, { conversationMode }).catch(() => undefined);
  }, []);

  React.useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey || !syncKey || syncUserId) return;

    const supabase = getSyncClient();
    if (!supabase) return;

    let cancelled = false;
    syncRegisterOrLogin(supabase, syncKey)
      .then((userId) => {
        if (!cancelled) setSyncUserId(userId);
      })
      .catch((e) => console.warn('[sync] auto-login failed:', e?.message));

    return () => {
      cancelled = true;
    };
  }, [supabaseUrl, supabaseAnonKey, syncKey, syncUserId, setSyncUserId]);

  React.useEffect(() => {
    if (!isReady) return;

    let previousVersions = new Map(
      useChatStore.getState().conversations
        .filter((c) => !c._isIncognito)
        .map((c) => [c.id, { version: c.updated ?? c.created, syncable: isConversationSyncable(c) }]),
    );

    const unsub = useChatStore.subscribe((state) => {
      if (isApplyingRemoteConversationChanges()) {
        previousVersions = new Map(
          state.conversations
            .filter((c) => !c._isIncognito)
            .map((c) => [c.id, { version: c.updated ?? c.created, syncable: isConversationSyncable(c) }]),
        );
        return;
      }

      const currentVersions = new Map<string, { version: number; syncable: boolean }>();
      const changed: string[] = [];
      const deleted: string[] = [];

      for (const conversation of state.conversations) {
        if (conversation._isIncognito) continue;
        const version = conversation.updated ?? conversation.created;
        const syncable = isConversationSyncable(conversation);
        currentVersions.set(conversation.id, { version, syncable });

        const previous = previousVersions.get(conversation.id);
        const versionChanged = previous?.version !== version;
        const becameSyncable = previous !== undefined && !previous.syncable && syncable;

        if ((versionChanged || becameSyncable) && syncable)
          changed.push(conversation.id);
      }

      for (const id of previousVersions.keys())
        if (!currentVersions.has(id))
          deleted.push(id);

      if (changed.length) addPendingChangedConversations(changed);
      if (deleted.length) addPendingDeletedConversations(deleted);
      if (changed.length || deleted.length) requestSync('chat-change');
      previousVersions = currentVersions;
    });

    return unsub;
  }, [isReady, addPendingChangedConversations, addPendingDeletedConversations, requestSync]);

  React.useEffect(() => {
    if (!isReady || syncStatus === 'syncing' || !needsResyncRef.current) return;

    const conversationMode = pendingResyncModeRef.current;
    pendingResyncModeRef.current = 'dirty';
    needsResyncRef.current = false;
    const supabase = getSyncClient();
    const { syncUserId: userId } = useSyncStore.getState();
    if (!supabase || !userId) return;
    performFullSync(supabase, userId, { conversationMode }).catch(() => undefined);
  }, [isReady, syncStatus]);

  React.useEffect(() => {
    if (!isReady || !isBrowser) return;

    const handleVisibilityChange = () => {
      if (document.hidden) return;
      requestSync('visibility');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const unsubscribeWindowFocus = WindowFocusObserver.getInstance().subscribe((focused) => {
      if (!focused || document.hidden) return;
      requestSync('focus');
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeWindowFocus();
    };
  }, [isReady, requestSync]);
}
