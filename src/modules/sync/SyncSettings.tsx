import * as React from 'react';

import CloudDoneRoundedIcon from '@mui/icons-material/CloudDoneRounded';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import { Alert, Box, Button, Chip, CircularProgress, Divider, FormControl, FormHelperText, FormLabel, IconButton, Input, Typography } from '@mui/joy';

import { useSyncStore } from './store-sync';
import { syncRegisterOrLogin } from './sync.auth';
import { clearSyncClient, getSyncClient } from './sync.client';
import { performFullSync } from './sync.operations';

function VisibilityToggleButton(props: {
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      size="sm"
      variant="plain"
      color="neutral"
      onClick={props.onToggle}
    >
      {props.show ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
    </IconButton>
  );
}

function formatTime(ms: number | null): string {
  if (!ms) return 'Never';
  return new Date(ms).toLocaleString();
}

function relativeTime(ms: number | null): string {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function SyncSettings() {
  const {
    supabaseUrl,
    supabaseAnonKey,
    syncKey,
    syncUserId,
    lastConversationSyncTime,
    lastBlobsSyncTime,
    lastStoresSyncTime,
    syncStatus,
    lastSyncError,
    lastSyncAt,
    setSyncConfig,
    setSyncUserId,
    resetSync,
  } = useSyncStore();

  const [localUrl, setLocalUrl] = React.useState(supabaseUrl);
  const [localAnonKey, setLocalAnonKey] = React.useState(supabaseAnonKey);
  const [localSyncKey, setLocalSyncKey] = React.useState(syncKey);
  const [storesReloadNeeded, setStoresReloadNeeded] = React.useState(false);
  const [showSupabaseKey, setShowSupabaseKey] = React.useState(false);
  const [showSyncKey, setShowSyncKey] = React.useState(false);

  const isConfigured = !!(supabaseUrl && supabaseAnonKey && syncKey);
  const isConnected = isConfigured && !!syncUserId;
  const isSyncing = syncStatus === 'syncing';
  const configDirty = localUrl !== supabaseUrl || localAnonKey !== supabaseAnonKey || localSyncKey !== syncKey;

  const handleConnect = React.useCallback(async () => {
    if (!localUrl || !localAnonKey || !localSyncKey) return;

    setSyncConfig({ supabaseUrl: localUrl, supabaseAnonKey: localAnonKey, syncKey: localSyncKey });

    const supabase = getSyncClient();
    if (!supabase) return;

    try {
      const userId = await syncRegisterOrLogin(supabase, localSyncKey);
      setSyncUserId(userId);
    } catch (e: any) {
      useSyncStore.getState().setSyncStatus('error', e?.message ?? 'Connect failed');
    }
  }, [localAnonKey, localSyncKey, localUrl, setSyncConfig, setSyncUserId]);

  const handleSync = React.useCallback(async () => {
    const supabase = getSyncClient();
    if (!supabase || !syncUserId) return;

    try {
      const { storesUpdated } = await performFullSync(supabase, syncUserId);
      if (storesUpdated) setStoresReloadNeeded(true);
    } catch {
      // performFullSync writes the error into useSyncStore
    }
  }, [syncUserId]);

  const handleReset = React.useCallback(() => {
    clearSyncClient();
    resetSync();
    setLocalUrl('');
    setLocalAnonKey('');
    setLocalSyncKey('');
    setStoresReloadNeeded(false);
  }, [resetSync]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {isConnected ? (
          <Chip color="success" size="sm" startDecorator={<CloudDoneRoundedIcon />}>
            Connected
          </Chip>
        ) : (
          <Chip color="neutral" size="sm" startDecorator={<CloudOffRoundedIcon />}>
            Not connected
          </Chip>
        )}
        {syncStatus === 'error' && (
          <Chip color="danger" size="sm" startDecorator={<ErrorOutlineRoundedIcon />}>
            Error
          </Chip>
        )}
        {isConnected && lastSyncAt && (
          <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
            Last sync: {relativeTime(lastSyncAt)}
          </Typography>
        )}
      </Box>

      <FormControl>
        <FormLabel>Supabase Project URL</FormLabel>
        <Input placeholder="https://xyz.supabase.co" value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} disabled={isSyncing} />
      </FormControl>

      <FormControl>
        <FormLabel>Supabase Anon / Publishable Key</FormLabel>
        <Input
          type={showSupabaseKey ? 'text' : 'password'}
          placeholder="eyJ... or sb_publishable_..."
          value={localAnonKey}
          onChange={(e) => setLocalAnonKey(e.target.value)}
          disabled={isSyncing}
          endDecorator={
            <VisibilityToggleButton
              show={showSupabaseKey}
              onToggle={() => setShowSupabaseKey((show) => !show)}
            />
          }
        />
        <FormHelperText>Use either the legacy `anon` key or the newer publishable key.</FormHelperText>
      </FormControl>

      <FormControl>
        <FormLabel>Sync Passphrase</FormLabel>
        <Input
          type={showSyncKey ? 'text' : 'password'}
          placeholder="A secret phrase shared across your devices"
          value={localSyncKey}
          onChange={(e) => setLocalSyncKey(e.target.value)}
          disabled={isSyncing}
          endDecorator={
            <VisibilityToggleButton
              show={showSyncKey}
              onToggle={() => setShowSyncKey((show) => !show)}
            />
          }
        />
        <FormHelperText>
          The same passphrase on any device gives access to the same sync data. The passphrase is hashed client-side and never stored in plaintext.
        </FormHelperText>
      </FormControl>

      <Alert color="warning" size="sm" startDecorator={<WarningRoundedIcon />}>
        <Typography level="body-xs">
          <b>Privacy note:</b> LLM and API keys stored in your browser (<em>Preferences -&gt; Models</em>) will be included in the sync. The Supabase database
          owner can read this data. Only sync to a project you control.
        </Typography>
      </Alert>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="solid"
          color="primary"
          loading={isSyncing && !isConnected}
          disabled={!localUrl || !localAnonKey || !localSyncKey || isSyncing}
          onClick={handleConnect}
          startDecorator={<CloudDoneRoundedIcon />}
        >
          {isConnected && !configDirty ? 'Reconnect' : 'Connect'}
        </Button>

        {isConnected && (
          <Button
            variant="solid"
            color="success"
            loading={isSyncing}
            disabled={isSyncing}
            onClick={handleSync}
            startDecorator={<SyncRoundedIcon />}
          >
            Sync Now
          </Button>
        )}

        {isConfigured && (
          <Button variant="outlined" color="danger" disabled={isSyncing} onClick={handleReset}>
            Disconnect &amp; Reset
          </Button>
        )}
      </Box>

      {syncStatus === 'error' && lastSyncError && (
        <Alert color="danger" size="sm">
          <Typography level="body-xs">{lastSyncError}</Typography>
        </Alert>
      )}

      {storesReloadNeeded && (
        <Alert color="primary" size="sm">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <Typography level="body-xs">Settings were updated from the server. Reload the page to apply them.</Typography>
            <Button size="sm" variant="solid" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </Box>
        </Alert>
      )}

      {isConnected && (
        <>
          <Divider />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
            {[
              ['Conversations', lastConversationSyncTime],
              ['Assets', lastBlobsSyncTime],
              ['Settings', lastStoresSyncTime],
              ['Full sync', lastSyncAt],
            ].map(([label, ts]) => (
              <React.Fragment key={label as string}>
                <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                  {label as string}
                </Typography>
                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                  {formatTime(ts as number | null)}
                </Typography>
              </React.Fragment>
            ))}
          </Box>

          <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
            User ID: <code>{syncUserId}</code>
          </Typography>
        </>
      )}
    </Box>
  );
}
