import * as z from 'zod/v4';

export const SyncConversationRowSchema = z.object({
  user_id: z.string(),
  conversation_id: z.string(),
  updated_at: z.number(),
  deleted_at: z.number().nullable(),
  data: z.any(),
});
export type SyncConversationRow = z.infer<typeof SyncConversationRowSchema>;

export const SyncAssetRowSchema = z.object({
  user_id: z.string(),
  asset_id: z.string(),
  asset_type: z.string(),
  mime_type: z.string(),
  storage_path: z.string(),
  metadata: z.record(z.string(), z.any()),
  updated_at: z.number(),
  deleted_at: z.number().nullable(),
});
export type SyncAssetRow = z.infer<typeof SyncAssetRowSchema>;

export const SyncStoreRowSchema = z.object({
  user_id: z.string(),
  store_key: z.string(),
  data: z.any(),
  updated_at: z.number(),
});
export type SyncStoreRow = z.infer<typeof SyncStoreRowSchema>;

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

export interface SyncResult {
  storesUpdated: boolean;
}
