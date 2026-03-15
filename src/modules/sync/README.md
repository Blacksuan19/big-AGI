# big-AGI Sync - Setup Guide

This module syncs all user data across devices using a self-hosted (or cloud)
[Supabase](https://supabase.com) project.

**What is synced**

| Data                           | Includes                                                                 | Method                                |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------- |
| Conversations & messages       | Full history, AI auto-titles, user-set titles (incognito chats excluded) | PostgreSQL (`sync_conversations`)     |
| Binary assets (images, audio)  | Attachments and AI-generated images referenced in chats                  | Supabase Storage bucket `sync-assets` |
| LLM service configs & API keys | All configured providers and their API keys                              | PostgreSQL (`sync_stores`)            |
| Personas, folders, UI settings | Custom personas, folder structure, preferences                           | PostgreSQL (`sync_stores`)            |

> **Privacy note:** LLM API keys stored in _Preferences -> Models_ are included
> in the sync. Only use a Supabase project that you control or fully trust.

## Installation

Follow these installation steps to provision Supabase and connect big-AGI to it.

### Step 1. Create a Supabase project

1. Go to [app.supabase.com](https://app.supabase.com) and create a **New Project**
   (or self-host with Docker - see [Self-hosting](#self-hosting-supabase) below).
2. Wait for the project to be provisioned.

### Step 2. Run the SQL schema

1. Open **SQL Editor** in the Supabase dashboard.
2. Click **New query**, paste the contents of
   [`supabase-schema.sql`](./supabase-schema.sql), and click **Run**.

   This creates the four tables, their indexes, RLS policies, and the scoped
   Storage policy all in one step.

### Step 3. Create the Storage bucket

1. Open **Storage** in the Supabase dashboard.
2. Click **New bucket**, name it exactly **`sync-assets`**.
3. Keep **Public bucket** **off** (private).

   The scoped policy for this bucket was already applied in step 2 - no
   separate policy step is needed.

   > The policy restricts uploads to paths prefixed by a registered
   > `sync_users.id`, preventing writes to arbitrary paths.

### Step 4. Configure in big-AGI

1. In the Supabase dashboard, go to **Project Settings -> API**.
2. Copy:
   - **Project URL** (e.g. `https://xyz.supabase.co`)
   - **Project API Keys -> publishable** key
     (legacy **anon** keys also work)
3. In big-AGI, open **Preferences -> Sync**.
4. Paste the URL and publishable/anon key, enter a memorable **passphrase** (the same
   passphrase on every device gives access to the same data).
5. Click **Connect**, then **Sync Now**.

## Using sync day-to-day

### Pulling the latest from another device

There are two ways to trigger an immediate pull:

- **Toolbar button**: a sync icon appears in the top chat bar when sync is
  connected. Click it to run a full sync cycle and pick up any changes made on
  another device.
- **Preferences -> Sync -> Sync Now**: the same full sync from inside settings.

### Auto-sync triggers

| Trigger                                         | Delay        | Notes                                          |
| ----------------------------------------------- | ------------ | ---------------------------------------------- |
| Any chat change (new message, title edit, etc.) | 3 s debounce | Fires after the last change in a burst settles |
| Tab becomes visible again                       | Immediate    | Good for catching up after background time     |
| Window regains focus                            | Immediate    | Good fallback for browser/tab activation       |

Use the toolbar button whenever you want changes from another device
immediately - auto-sync is still not a real-time channel.

Notes:

- This is not a realtime channel. One browser pulling does not directly wake or notify another browser. Each client only syncs when it hits its own debounce, manual pull, or local visibility/focus triggers.
- Some browsers may appear "slower" to sync when the tab is inactive because timers and tab lifecycle work can be deferred by the browser.

### Settings stores

When settings (models, personas, folders, UI preferences) are pulled from
another device, a **Reload** prompt appears in the Sync panel. A page reload
is required to apply them because those stores are loaded once at startup.

---

## Sync model

### Identity

The passphrase is SHA-256-hashed **client-side**. Only the hash is stored in
`sync_users.sync_key_hash`. The raw passphrase never leaves the browser. Any
device that presents the same hash gains access to the same data.

Implementation notes:

- big-AGI uses Web Crypto when available and falls back to an internal SHA-256 implementation when a browser context does not expose `crypto.subtle`.
- This avoids sync setup failures in browsers/contexts where Web Crypto is unavailable.

### Conversations

- **Push**: local conversation changes are tracked incrementally as chats mutate, and only those dirty conversation IDs are serialized and upserted. Both message edits **and title changes** bump `updated`, so all changes are captured without rescanning the full local conversation list on every sync.
- **Pull**: rows with `updated_at > lastConversationSyncTime` are fetched and merged.
- **Conflict resolution**: last-write-wins per conversation, keyed by `updated_at`.
- **Deletion**: soft-delete tombstones (`deleted_at` set, `data = null`) propagate deletes across devices.
- Incognito conversations are excluded from sync. This matches the existing chat-store behavior, where incognito conversations are intentionally filtered out before persistence, so they are treated as local-only/private rather than durable synced state.
- Remote conversation changes applied during a pull are ignored by the auto-sync watcher, so pulling from another device does not immediately trigger a redundant local re-push.
- This optimization mainly improves scalability for users with many chats; it reduces unnecessary local work during sync wake-ups, but browser/runtime differences can still make Firefox feel slower than Chromium-based browsers.

### Binary assets (images, audio)

- Assets are stored in Dexie (IndexedDB) under their original dblob nanoid. That same ID is used as the `asset_id` in `sync_assets` and as the Storage path, so fragment references resolve correctly after a pull.
- **Push**: assets updated since `lastBlobsSyncTime` are uploaded to `sync-assets/{userId}/{assetId}.{ext}`, then a metadata row is upserted in `sync_assets`.
- **Pull**: asset IDs referenced in local message fragments that are absent from local Dexie are downloaded from Storage and inserted.
- If any upload fails, `lastBlobsSyncTime` is **not** advanced, so failed assets are automatically retried on the next cycle.
- Local blob timestamps are normalized during sync so older rows that deserialize `updatedAt` as a string/number still sync correctly.

### Stores (settings)

- On a brand-new client, stores are **pulled first** before any store push happens. This prevents an empty browser from overwriting the remote `app-models` and other settings with its local defaults.
- After the initial pull, settings stores are only pushed when their serialized local payload changed. This avoids re-pushing models/UI settings on every chat sync cycle.
- Pull fetches keys updated on the server since `lastStoresSyncTime` and writes them to `localStorage`. A page reload is required to activate pulled settings.

### Browser notes

Observed during testing:

- Firefox can sometimes look "busy" for longer than Chromium-based browsers during sync, especially after recent local changes or when the tab was inactive.
- Chromium-based browsers (for example Vivaldi and VS Code's simple browser) may feel more immediate in the same workflow.
- A Firefox tab can also appear to "resume" syncing a bit later even if no new local action happened. In practice this usually means one of this client's own delayed timers finally ran after the tab became active again; another client's pull does not directly notify or wake this browser.

Documented browser behavior behind this:

- Background-tab timer throttling is expected browser behavior. Browsers commonly slow down `setTimeout`/`setInterval` work in hidden tabs, and Firefox documents both general background timeout budgeting and longer timer delays for inactive tabs.
- This sync module uses ordinary browser timers for the 3-second local-change debounce, and uses visibility/focus events to catch up when a tab becomes active again.

Practical workarounds:

- Keep the tab active while testing sync timing.
- Use the manual pull button when checking another device immediately after a change.
- Treat the Sync button as the reliable "fetch now" path across devices; the automatic sync is best-effort and not a realtime transport.
- big-AGI now reacts to `visibilitychange` and window focus to catch up when a tab becomes active again, which is more reliable than relying on a coarse background polling interval.
- Conversation push no longer rescans the full local chat list to discover dirty chats, so larger histories should scale better even though Firefox may still show a longer loading indicator for other browser-specific reasons.
- If settings changed, reload after pull so the updated stores are applied cleanly.
- If a browser appears to keep syncing after a pull, wait for the current cycle to finish before comparing another device; overlapping debounce/interval activity can still make the indicator reappear briefly.

### Security & RLS

The anon key is embedded in every client's browser settings. RLS policies use
`USING (true)` - Supabase will flag these as "RLS Policy Always True"
advisories, which is **intentional**: isolation is enforced at the query level
via explicit `user_id` filters. A valid `user_id` UUID is only obtainable by
presenting the correct passphrase hash.

For a personal or self-hosted deployment this is acceptable. For a multi-user
shared deployment, migrate to Supabase Auth and replace the `(true)` policies
with `auth.uid()`-based checks.

## Self-hosting Supabase

```bash
git clone https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
# edit .env - set POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, etc.
docker compose up -d
```

Your Project URL will be `http://localhost:8000` (Kong gateway). The anon key
is the JWT signed with `JWT_SECRET` from `.env` - use the pre-generated keys
from the example `.env` for local testing, or generate new ones for production.
