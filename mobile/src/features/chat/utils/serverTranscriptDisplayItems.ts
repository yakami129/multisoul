import type { TranscriptItem } from '@/features/chat/types';
import type { WsMessage } from '@/types';
import {
  collapseTodoToolCallSnapshots,
  groupAdjacentUserImageMessages,
  type ChatTranscriptDisplayItem,
  isRenderableInChatTranscript,
} from './chatRenderState';

function renderableMessages(messages: WsMessage[]): WsMessage[] {
  return collapseTodoToolCallSnapshots(messages.filter(isRenderableInChatTranscript));
}

export function buildServerTranscriptDisplayItems(
  pageItems: TranscriptItem[],
): ChatTranscriptDisplayItem[] {
  const displayItems: ChatTranscriptDisplayItem[] = [];

  for (const item of pageItems) {
    if (item.kind === 'prelude_raw' || item.kind === 'current_turn_raw') {
      for (const message of renderableMessages(item.messages)) {
        displayItems.push({ kind: 'message', message });
      }
      continue;
    }

    displayItems.push({ kind: 'message', message: item.user });

    if (item.worked) {
      displayItems.push({
        kind: 'server_worked',
        id: `worked-${item.turn_id}`,
        turnId: item.turn_id,
        label: item.worked.label,
        hiddenCount: item.worked.hidden_count,
        messages: [],
      });
    }

    for (const ask of item.asks) {
      displayItems.push({ kind: 'message', message: ask });
    }

    if (item.final_agent) {
      displayItems.push({ kind: 'message', message: item.final_agent });
    }
  }

  return groupAdjacentUserImageMessages(displayItems);
}
