import * as React from 'react';

import { useChatStore } from '~/common/stores/chat/store-chats';
import { isBrowser } from '~/common/util/pwaUtils';
import { WindowFocusObserver } from '~/common/util/windowUtils';

import { useSyncStore } from './store-sync';
import { syncRegisterOrLogin } from './sync.auth';
import { getSyncClient } from './sync.client';
import { isApplyingRemoteConversationChanges } from './sync.operations';
import { performFullSync } from './sync.operations';

const DEBOUNCE_MS = 3_000;
const WAKE_SYNC_DEDUPE_MS = 1_500;

export function useAutoSync() {
  const { supabaseUrl, supabaseAnonKey, syncKey, syncUserId, syncStatus, setSyncUserId, addPendingChangedConversations, addPendingDeletedConversations } = useSyncStore();

  const isReady = !!(supabaseUrl && supabaseAnonKey && syncKey && syncUserId);
  const needsResyncRef = React.useRef(false);
  const lastWakeSyncAtRef = React.useRef(0);

  const requestSync = React.useCallback((reason: 'chat-change' | 'visibility' | 'focus') => {
    const supabase = getSyncClient();
    const { syncUserId: userId, syncStatus } = useSyncStore.getState();
    if (!supabase || !userId) return;

    if (reason !== 'chat-change') {
      const now = Date.now();
      if (now - lastWakeSyncAtRef.current < WAKE_SYNC_DEDUPE_MS) return;
      lastWakeSyncAtRef.current = now;
    }

    if (syncStatus === 'syncing') {
      needsResyncRef.current = true;
      return;
    }

    performFullSync(supabase, userId).catch(() => undefined);
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
        .map((c) => [c.id, c.updated ?? c.created]),
    );

    const unsub = useChatStore.subscribe((state) => {
      if (isApplyingRemoteConversationChanges()) {
        previousVersions = new Map(
          state.conversations
            .filter((c) => !c._isIncognito)
            .map((c) => [c.id, c.updated ?? c.created]),
        );
        return;
      }

      const currentVersions = new Map<string, number>();
      const changed: string[] = [];
      const deleted: string[] = [];

      for (const conversation of state.conversations) {
        if (conversation._isIncognito) continue;
        const version = conversation.updated ?? conversation.created;
        currentVersions.set(conversation.id, version);
        if (previousVersions.get(conversation.id) !== version)
          changed.push(conversation.id);
      }

      for (const id of previousVersions.keys())
        if (!currentVersions.has(id))
          deleted.push(id);

      if (changed.length) addPendingChangedConversations(changed);
      if (deleted.length) addPendingDeletedConversations(deleted);
      previousVersions = currentVersions;
    });

    return unsub;
  }, [isReady, addPendingChangedConversations, addPendingDeletedConversations]);

  React.useEffect(() => {
    if (!isReady) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const unsub = useChatStore.subscribe(() => {
      if (isApplyingRemoteConversationChanges()) return;

      if (debounceTimer) clearTimeout(debounceTimer);

      debounceTimer = setTimeout(() => {
        requestSync('chat-change');
      }, DEBOUNCE_MS);
    });

    return () => {
      unsub();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [isReady, requestSync]);

  React.useEffect(() => {
    if (!isReady || syncStatus === 'syncing' || !needsResyncRef.current) return;

    needsResyncRef.current = false;
    requestSync('chat-change');
  }, [isReady, requestSync, syncStatus]);

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
