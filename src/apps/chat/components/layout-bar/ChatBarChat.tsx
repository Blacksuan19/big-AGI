import * as React from 'react';

import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import { CircularProgress, IconButton } from '@mui/joy';

import { GoodTooltip } from '~/common/components/GoodTooltip';
import type { DConversationId } from '~/common/stores/chat/chat.conversation';
import type { OptimaBarControlMethods } from '~/common/layout/optima/bar/OptimaBarDropdown';
import { useSyncStore } from '~/modules/sync/store-sync';
import { getSyncClient } from '~/modules/sync/sync.client';
import { performFullSync } from '~/modules/sync/sync.operations';

import { useChatLLMDropdown } from './useLLMDropdown';
import { usePersonaIdDropdown } from './usePersonaDropdown';
import { useFolderDropdown } from './useFolderDropdown';


export function ChatBarChat(props: {
  conversationId: DConversationId | null;
  llmDropdownRef: React.Ref<OptimaBarControlMethods>;
  personaDropdownRef: React.Ref<OptimaBarControlMethods>;
}) {

  // state
  const { chatLLMDropdown } = useChatLLMDropdown(props.llmDropdownRef);
  const { personaDropdown } = usePersonaIdDropdown(props.conversationId, props.personaDropdownRef);
  const { folderDropdown } = useFolderDropdown(props.conversationId);
  const syncUserId = useSyncStore((s) => s.syncUserId);
  const syncStatus = useSyncStore((s) => s.syncStatus);
  const isSyncing = syncStatus === 'syncing';

  const handleSyncPull = React.useCallback(async () => {
    const userId = useSyncStore.getState().syncUserId;
    const supabase = getSyncClient();
    if (!supabase || !userId) return;

    try {
      await performFullSync(supabase, userId);
    } catch {
      // performFullSync writes the error into useSyncStore
    }
  }, []);

  return <>

    {/* Persona selector */}
    {personaDropdown}

    {/* Model selector */}
    {chatLLMDropdown}

    {/* Folder selector */}
    {folderDropdown}

    {/* Sync pull button - only shown when sync is configured */}
    {!!syncUserId && (
      <GoodTooltip title={isSyncing ? 'Syncing...' : 'Pull latest from sync'}>
        <IconButton
          size='sm'
          variant='plain'
          color='neutral'
          disabled={isSyncing}
          onClick={handleSyncPull}
          sx={{ color: 'text.secondary' }}
        >
          {isSyncing ? <CircularProgress size='sm' sx={{ '--CircularProgress-size': '16px' }} /> : <SyncRoundedIcon />}
        </IconButton>
      </GoodTooltip>
    )}

  </>;
}
