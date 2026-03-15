-- big-AGI Sync - Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Also create a Storage bucket named "sync-assets" (see README.md).

create table if not exists sync_users (
  id              uuid primary key default gen_random_uuid(),
  sync_key_hash   text not null unique,
  created_at      timestamptz not null default now()
);

create table if not exists sync_conversations (
  user_id         uuid not null references sync_users(id) on delete cascade,
  conversation_id text not null,
  updated_at      bigint not null,
  deleted_at      bigint,
  data            jsonb,
  primary key (user_id, conversation_id)
);

create index if not exists idx_sync_conversations_user_updated
  on sync_conversations (user_id, updated_at);

create table if not exists sync_assets (
  user_id         uuid not null references sync_users(id) on delete cascade,
  asset_id        text not null,
  asset_type      text not null,
  mime_type       text not null,
  storage_path    text not null,
  metadata        jsonb not null default '{}',
  updated_at      bigint not null,
  deleted_at      bigint,
  primary key (user_id, asset_id)
);

create index if not exists idx_sync_assets_user_updated
  on sync_assets (user_id, updated_at);

create table if not exists sync_stores (
  user_id         uuid not null references sync_users(id) on delete cascade,
  store_key       text not null,
  data            jsonb not null,
  updated_at      bigint not null,
  primary key (user_id, store_key)
);

create index if not exists idx_sync_stores_user_updated
  on sync_stores (user_id, updated_at);

alter table sync_users enable row level security;
alter table sync_conversations enable row level security;
alter table sync_assets enable row level security;
alter table sync_stores enable row level security;

create policy "anon full access - sync_users"
  on sync_users for all using (true) with check (true);

create policy "anon full access - sync_conversations"
  on sync_conversations for all using (true) with check (true);

create policy "anon full access - sync_assets"
  on sync_assets for all using (true) with check (true);

create policy "anon full access - sync_stores"
  on sync_stores for all using (true) with check (true);

create policy "anon sync-assets scoped"
  on storage.objects for all
  using (
    bucket_id = 'sync-assets'
    and (storage.foldername(name))[1] in (
      select id::text from public.sync_users
    )
  )
  with check (
    bucket_id = 'sync-assets'
    and (storage.foldername(name))[1] in (
      select id::text from public.sync_users
    )
  );
