import React from 'react';
import { StoredMessage } from '../../storage/types';
import { Theme } from '../theme';

export interface MessageBubbleProps {
  message: StoredMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isOutgoing = message.isOutgoing;

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getStatusIcon = (status: StoredMessage['deliveryStatus']) => {
    switch (status) {
      case 'pending':
        return '🕒';
      case 'sent':
        return '✓';
      case 'delivered':
        return '✓✓';
      case 'failed':
        return '⚠️';
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isOutgoing ? 'flex-end' : 'flex-start',
        marginBottom: Theme.spacing.sm,
        width: '100%',
      }}
    >
      <div
        style={{
          maxWidth: '75%',
          backgroundColor: isOutgoing
            ? Theme.colors.bubbleOutgoing
            : Theme.colors.bubbleIncoming,
          border: `1px solid ${
            isOutgoing
              ? Theme.colors.bubbleOutgoingBorder
              : Theme.colors.bubbleIncomingBorder
          }`,
          borderRadius: Theme.radius.lg,
          padding: `${Theme.spacing.sm}px ${Theme.spacing.md}px`,
          wordBreak: 'break-word',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      >
        <p
          style={{
            margin: 0,
            color: Theme.colors.textPrimary,
            fontSize: Theme.typography.sizes.md,
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
          }}
        >
          {message.body}
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: Theme.spacing.xs,
            marginTop: Theme.spacing.xs,
          }}
        >
          <span
            style={{
              fontSize: Theme.typography.sizes.xs,
              color: isOutgoing ? Theme.colors.primaryLight : Theme.colors.textMuted,
            }}
          >
            {formatTime(message.timestamp)}
          </span>

          {isOutgoing && (
            <span
              style={{
                fontSize: Theme.typography.sizes.xs,
                color:
                  message.deliveryStatus === 'failed'
                    ? Theme.colors.danger
                    : message.deliveryStatus === 'delivered'
                    ? Theme.colors.primaryLight
                    : Theme.colors.textMuted,
              }}
            >
              {getStatusIcon(message.deliveryStatus)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

