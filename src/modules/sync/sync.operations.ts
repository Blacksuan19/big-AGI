import type { SupabaseClient } from '@supabase/supabase-js';

import { isContentOrAttachmentFragment, isImageRefPart, isZyncAssetReferencePart } from '~/common/stores/chat/chat.fragments';
import { DataAtRestV1 } from '~/common/stores/chat/chats.converters';
import { useChatStore } from '~/common/stores/chat/store-chats';
import { getDBAsset, getDBAssetsUpdatedAfter, putDBAsset } from '~/modules/dblobs/dblobs.db';
import type { DBlobDBAsset } from '~/modules/dblobs/dblobs.types';

import { useSyncStore } from './store-sync';
import type { SyncResult } from './sync.types';

const STORAGE_BUCKET = 'sync-assets';
let _isApplyingRemoteConversationChanges = false;

export function isApplyingRemoteConversationChanges(): boolean {
  return _isApplyingRemoteConversationChanges;
}

/**
 * localStorage keys that are synced across devices.
 * 'app-chats' is deliberately excluded - conversations go through syncConversations().
 */
const SYNC_STORE_KEYS = [
  'app-models',
  'app-folders',
  'app-ui',
  'app-ux-labs',
  'app-app-personas',
  'app-app-chat',
  'app-app-call',
  'app-purpose',
  'app-module-browse',
  'app-module-t2i',
  'app-module-dalle',
  'app-module-speex',
  'app-module-google-search',
] as const;

async function syncConversations(supabase: SupabaseClient, userId: string): Promise<void> {
  const {
    lastConversationSyncTime,
    pendingChangedConversationIds,
    pendingDeletedConversationIds,
    setLastConversationSyncTime,
    clearPendingChangedConversations,
    clearPendingDeletedConversations,
  } = useSyncStore.getState();
  const now = Date.now();
  let latestSeenConversationUpdate = lastConversationSyncTime;

  const conversationsById = new Map(useChatStore.getState().conversations.map((conversation) => [conversation.id, conversation]));
  const pendingChangedIds = [...new Set(pendingChangedConversationIds)];
  const toUpsert = pendingChangedIds
    .map((id) => conversationsById.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c && !c._isIncognito)
    .map((c) => ({
      user_id: userId,
      conversation_id: c.id,
      updated_at: c.updated ?? c.created,
      deleted_at: null,
      data: DataAtRestV1.formatChatToJsonV1(c),
    }));
  for (const row of toUpsert)
    latestSeenConversationUpdate = Math.max(latestSeenConversationUpdate, row.updated_at);

  if (pendingChangedIds.length > 0 && toUpsert.length === 0)
    clearPendingChangedConversations(pendingChangedIds);

  if (toUpsert.length > 0) {
    const { error } = await supabase.from('sync_conversations').upsert(toUpsert, { onConflict: 'user_id,conversation_id' });
    if (error) throw new Error(`Push conversations failed: ${error.message}`);
    clearPendingChangedConversations(pendingChangedIds);
  }

  const pendingIds = [...pendingDeletedConversationIds];
  if (pendingIds.length > 0) {
    const tombstones = pendingIds.map((id) => ({
      user_id: userId,
      conversation_id: id,
      updated_at: now,
      deleted_at: now,
      data: null,
    }));
    latestSeenConversationUpdate = Math.max(latestSeenConversationUpdate, now);
    const { error } = await supabase.from('sync_conversations').upsert(tombstones, { onConflict: 'user_id,conversation_id' });
    if (error) throw new Error(`Push deletions failed: ${error.message}`);
    clearPendingChangedConversations(pendingIds);
    clearPendingDeletedConversations(pendingIds);
  }

  const { data: remoteRows, error: pullError } = await supabase
    .from('sync_conversations')
    .select('conversation_id, updated_at, deleted_at, data')
    .eq('user_id', userId)
    .gt('updated_at', lastConversationSyncTime);
  if (pullError) throw new Error(`Pull conversations failed: ${pullError.message}`);

  _isApplyingRemoteConversationChanges = true;
  try {
    for (const row of remoteRows ?? []) {
      latestSeenConversationUpdate = Math.max(latestSeenConversationUpdate, row.updated_at ?? 0);
      if (row.deleted_at) {
        const existsLocally = useChatStore.getState().conversations.some((c) => c.id === row.conversation_id);
        if (existsLocally) useChatStore.getState().deleteConversations([row.conversation_id]);
      } else if (row.data) {
        const conv = DataAtRestV1.recreateConversation(row.data);
        if (conv) useChatStore.getState().importConversation(conv, false);
      }
    }
  } finally {
    _isApplyingRemoteConversationChanges = false;
  }

  setLastConversationSyncTime(Math.max(now, latestSeenConversationUpdate));
}

async function syncBlobs(supabase: SupabaseClient, userId: string): Promise<void> {
  const { lastBlobsSyncTime, setLastBlobsSyncTime } = useSyncStore.getState();
  const now = Date.now();
  const pushFailures: string[] = [];

  const localAssets = await getDBAssetsUpdatedAfter(new Date(lastBlobsSyncTime));

  for (const asset of localAssets) {
    const ext = _mimeToExt(asset.data.mimeType);
    const storagePath = `${userId}/${asset.id}.${ext}`;

    const binary = _base64ToUint8Array(asset.data.base64);
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, binary, { contentType: asset.data.mimeType, upsert: true });
    if (uploadError) {
      console.error(`[sync] blob upload failed for ${asset.id}:`, uploadError.message);
      pushFailures.push(asset.id);
      continue;
    }

    const { error: metaError } = await supabase.from('sync_assets').upsert(
      {
        user_id: userId,
        asset_id: asset.id,
        asset_type: asset.assetType,
        mime_type: asset.data.mimeType,
        storage_path: storagePath,
        metadata: {
          label: asset.label,
          origin: asset.origin,
          metadata: asset.metadata,
          contextId: asset.contextId,
          scopeId: asset.scopeId,
        },
        updated_at: toUnixMillis(asset.updatedAt),
        deleted_at: null,
      },
      { onConflict: 'user_id,asset_id' },
    );
    if (metaError) {
      console.error(`[sync] blob metadata upsert failed for ${asset.id}:`, metaError.message);
      pushFailures.push(asset.id);
    }
  }

  const referencedIds = _collectDblobAssetIds();
  if (referencedIds.size > 0) {
    const { data: remoteAssets, error: metaFetchError } = await supabase
      .from('sync_assets')
      .select('asset_id, asset_type, mime_type, storage_path, metadata')
      .eq('user_id', userId)
      .in('asset_id', [...referencedIds])
      .is('deleted_at', null);
    if (metaFetchError) throw new Error(`Pull blob metadata failed: ${metaFetchError.message}`);

    for (const row of remoteAssets ?? []) {
      const existing = await getDBAsset(row.asset_id);
      if (existing) continue;

      const { data: fileData, error: dlError } = await supabase.storage.from(STORAGE_BUCKET).download(row.storage_path);
      if (dlError || !fileData) {
        console.warn(`[sync] blob download failed for ${row.asset_id}:`, dlError?.message);
        continue;
      }

      const base64 = await _blobToBase64(fileData);
      const meta = (row.metadata as Record<string, any>) ?? {};

      const newAsset = {
        id: row.asset_id,
        assetType: row.asset_type,
        label: meta.label ?? row.asset_id,
        data: { mimeType: row.mime_type, base64 },
        origin: meta.origin ?? { ot: 'user', source: 'attachment', media: 'sync' },
        metadata: meta.metadata ?? {},
        cache: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        contextId: meta.contextId ?? 'global',
        scopeId: meta.scopeId ?? 'app-chat',
      } as unknown as DBlobDBAsset;

      await putDBAsset(newAsset);
    }
  }

  if (pushFailures.length > 0)
    throw new Error(`Blob sync failed for ${pushFailures.length} asset(s): ${pushFailures.slice(0, 3).join(', ')}${pushFailures.length > 3 ? '...' : ''}`);

  setLastBlobsSyncTime(now);
}

async function syncStores(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { lastStoresSyncTime, lastStoreSyncHashes, setLastStoresSyncTime, setLastStoreSyncHashes } = useSyncStore.getState();
  const now = Date.now();
  let storesUpdated = false;
  const nextHashes = { ...lastStoreSyncHashes };

  // First-time store sync should pull before any push, otherwise a fresh browser
  // can overwrite remote settings (for example app-models) with local defaults.
  if (lastStoresSyncTime === 0) {
    const { data: initialRemoteStores, error: initialPullError } = await supabase
      .from('sync_stores')
      .select('store_key, data, updated_at')
      .eq('user_id', userId);
    if (initialPullError) throw new Error(`Initial pull stores failed: ${initialPullError.message}`);

    for (const row of initialRemoteStores ?? []) {
      try {
        const raw = JSON.stringify(row.data);
        localStorage.setItem(row.store_key, raw);
        nextHashes[row.store_key] = hashStorePayload(raw);
        storesUpdated = true;
      } catch {
        console.warn(`[sync] failed to write store key "${row.store_key}"`);
      }
    }

    const latestRemoteUpdate = Math.max(
      0,
      ...(initialRemoteStores ?? []).map((row) => row.updated_at || 0),
    );
    setLastStoreSyncHashes(nextHashes);
    setLastStoresSyncTime(latestRemoteUpdate || now);
    return storesUpdated;
  }

  const toPush = SYNC_STORE_KEYS.flatMap((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    try {
      const hash = hashStorePayload(raw);
      if (nextHashes[key] === hash)
        return [];
      nextHashes[key] = hash;
      return [{ user_id: userId, store_key: key, data: JSON.parse(raw), updated_at: now }];
    } catch {
      return [];
    }
  });

  if (toPush.length > 0) {
    const { error } = await supabase.from('sync_stores').upsert(toPush, { onConflict: 'user_id,store_key' });
    if (error) throw new Error(`Push stores failed: ${error.message}`);
  }

  const { data: remoteStores, error: pullError } = await supabase
    .from('sync_stores')
    .select('store_key, data, updated_at')
    .eq('user_id', userId)
    .gt('updated_at', lastStoresSyncTime);
  if (pullError) throw new Error(`Pull stores failed: ${pullError.message}`);

  for (const row of remoteStores ?? []) {
    try {
      const raw = JSON.stringify(row.data);
      const hash = hashStorePayload(raw);
      if (nextHashes[row.store_key] !== hash) {
        localStorage.setItem(row.store_key, raw);
        storesUpdated = true;
      }
      nextHashes[row.store_key] = hash;
    } catch {
      console.warn(`[sync] failed to write store key "${row.store_key}"`);
    }
  }

  setLastStoreSyncHashes(nextHashes);
  setLastStoresSyncTime(now);
  return storesUpdated;
}

export async function performFullSync(supabase: SupabaseClient, userId: string): Promise<SyncResult> {
  const { setSyncStatus, setLastSyncAt } = useSyncStore.getState();
  setSyncStatus('syncing');

  try {
    await syncConversations(supabase, userId);
    await syncBlobs(supabase, userId);
    const storesUpdated = await syncStores(supabase, userId);

    setSyncStatus('success');
    setLastSyncAt(Date.now());
    return { storesUpdated };
  } catch (e: any) {
    const msg: string = e?.message ?? 'Unknown sync error';
    setSyncStatus('error', msg);
    throw e;
  }
}

function _base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function _blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function _mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
  };
  return map[mimeType] ?? 'bin';
}

function toUnixMillis(value: Date | string | number | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function hashStorePayload(raw: string): string {
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${raw.length}:${(hash >>> 0).toString(16)}`;
}

function _collectDblobAssetIds(): Set<string> {
  const ids = new Set<string>();
  for (const conv of useChatStore.getState().conversations) {
    for (const message of conv.messages) {
      for (const fragment of message.fragments) {
        if (!isContentOrAttachmentFragment(fragment)) continue;
        if (isZyncAssetReferencePart(fragment.part) && fragment.part._legacyImageRefPart?.dataRef?.reftype === 'dblob')
          ids.add(fragment.part._legacyImageRefPart.dataRef.dblobAssetId);
        if (isImageRefPart(fragment.part) && fragment.part.dataRef?.reftype === 'dblob') ids.add(fragment.part.dataRef.dblobAssetId);
      }
    }
  }
  return ids;
}
