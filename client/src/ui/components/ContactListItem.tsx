import React from 'react';
import { ContactRecord, StoredMessage } from '../../storage/types';
import { Theme } from '../theme';

export interface ContactListItemProps {
  contact: ContactRecord;
  lastMessage?: StoredMessage | null;
  unreadCount?: number;
  onPress: () => void;
}

export const ContactListItem: React.FC<ContactListItemProps> = ({
  contact,
  lastMessage,
  unreadCount = 0,
  onPress,
}) => {
  const displayName =
    contact.alias ||
    `${contact.recipientPubkeyHash.substring(0, 8)}...${contact.recipientPubkeyHash.substring(
      contact.recipientPubkeyHash.length - 6
    )}`;

  const avatarLetter = (contact.alias || contact.recipientPubkeyHash)[0].toUpperCase();

  const formatLastTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div
      onClick={onPress}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: `${Theme.spacing.md}px ${Theme.spacing.lg}px`,
        backgroundColor: Theme.colors.surface,
        borderBottom: `1px solid ${Theme.colors.border}`,
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: Theme.radius.full,
          backgroundColor: Theme.colors.surfaceSecondary,
          border: `1px solid ${Theme.colors.borderLight}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: Theme.colors.primary,
          fontWeight: Theme.typography.weights.bold,
          fontSize: Theme.typography.sizes.lg,
          marginRight: Theme.spacing.md,
          flexShrink: 0,
        }}
      >
        {avatarLetter}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: Theme.spacing.xs,
          }}
        >
          <span
            style={{
              color: Theme.colors.textPrimary,
              fontSize: Theme.typography.sizes.md,
              fontWeight: Theme.typography.weights.semibold,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {displayName}
          </span>

          {lastMessage && (
            <span
              style={{
                color: Theme.colors.textMuted,
                fontSize: Theme.typography.sizes.xs,
                marginLeft: Theme.spacing.sm,
              }}
            >
              {formatLastTime(lastMessage.timestamp)}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span
            style={{
              color: Theme.colors.textSecondary,
              fontSize: Theme.typography.sizes.sm,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: 1,
            }}
          >
            {lastMessage ? lastMessage.body : 'Žádné zprávy'}
          </span>

          {unreadCount > 0 && (
            <div
              style={{
                backgroundColor: Theme.colors.primary,
                color: '#000000',
                borderRadius: Theme.radius.full,
                padding: '2px 6px',
                fontSize: Theme.typography.sizes.xs,
                fontWeight: Theme.typography.weights.bold,
                marginLeft: Theme.spacing.sm,
                flexShrink: 0,
              }}
            >
              {unreadCount}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

