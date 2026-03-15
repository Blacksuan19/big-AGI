# big-AGI Sync

This module syncs big-AGI data across devices using a Supabase project you
control.

**What syncs**

| Data          | Includes                                                 | Backend                                      |
| ------------- | -------------------------------------------------------- | -------------------------------------------- |
| Conversations | Messages, auto-titles, user titles, deletes              | `sync_conversations`                         |
| Assets        | Chat attachments and generated media referenced by chats | Storage bucket `sync-assets` + `sync_assets` |
| Settings      | Models, API keys, personas, folders, UI preferences      | `sync_stores`                                |

Incognito conversations are excluded and remain local-only.

> Privacy note: model API keys stored in the browser are included in sync. Only
> use a Supabase project that you control or trust.

## Setup

### 1. Create a Supabase project

Create a new project in Supabase, or use your own self-hosted deployment.

### 2. Run the schema

Open the Supabase SQL editor and run [`supabase-schema.sql`](./supabase-schema.sql).

This creates:

- the sync tables
- indexes
- row-level security policies
- the storage policy for synced assets

### 3. Create the storage bucket

Create a private storage bucket named `sync-assets`.

### 4. Connect big-AGI

In big-AGI, open `Preferences -> Sync` and provide:

- Supabase project URL
- Supabase publishable key or legacy anon key
- a passphrase shared across your devices

Then click `Connect`, followed by `Sync Now`.

## Day-to-day use

There are three ways sync runs:

- local chat changes sync automatically
- switching back to a tab or window triggers a catch-up sync
- `Sync Now` runs an immediate manual sync

This is not a realtime channel. One client syncing does not directly notify the
others; another device catches up on focus/visibility or when you trigger a
manual sync.

If settings are pulled from another device, the Sync panel prompts for a page
reload so those stores can be applied cleanly.

## How it works

### Identity

The passphrase is hashed client-side before use. The raw passphrase is not sent
to Supabase.

big-AGI uses Web Crypto when available and falls back to an internal SHA-256
implementation when needed.

### Conversations

- Normal local edits use dirty conversation tracking as an optimization.
- Manual sync, focus sync, and the first sync on a client use fuller
  reconciliation based on remote presence and `updated_at`.
- Remote rows newer than local are pulled and merged.
- Deletes propagate through tombstones.
- Conflict resolution is last-write-wins by `updated_at`.

### Assets

- Changed local assets are uploaded to `sync-assets/{userId}/{assetId}.{ext}`.
- Referenced remote assets missing from local storage are downloaded on pull.
- Blob timestamp normalization handles older local rows whose `updatedAt` is not
  deserialized as a `Date`.

### Settings

- A new client pulls settings before pushing any local defaults.
- After that, settings are only pushed when the serialized store payload
  changes.
- Pulled settings are written to `localStorage`, so a reload is required to
  activate them.

## Implementation notes

- Remote conversation changes applied during pull are ignored by the local
  auto-sync watcher, so pulls do not immediately re-push the same chats.
- Large conversation and asset metadata operations are batched to avoid
  Supabase statement timeouts on bigger histories.

## Security model

The browser uses the project's publishable or anon key. Access isolation is
based on the sync identity and explicit `user_id` filtering in queries.

For a personal or self-hosted setup this is usually fine. For a shared
multi-user deployment, the better long-term path is Supabase Auth with
user-bound policies.

## Self-hosting Supabase

```bash
git clone https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
docker compose up -d
```

Then use your local Supabase URL and public client key in `Preferences -> Sync`.
