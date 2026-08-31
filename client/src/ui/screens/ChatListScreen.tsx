import React from 'react';
import { ContactListItem } from '../components/ContactListItem';
import { ScreenContainer } from '../components/ScreenContainer';
import { TorStatusBadge } from '../components/TorStatusBadge';
import { useOrchestrator } from '../context/OrchestratorContext';
import { Theme } from '../theme';
import { NavigationProp } from '../types';

export interface ChatListScreenProps {
  navigation: NavigationProp;
}

export const ChatListScreen: React.FC<ChatListScreenProps> = ({ navigation }) => {
  const { conversations, torStatus, torProgress, selectConversation } = useOrchestrator();

  const handleSelectContact = async (pubkeyHash: string, alias?: string | null) => {
    await selectConversation(pubkeyHash);
    navigation.navigate('Chat', { contactPubkeyHash: pubkeyHash, alias: alias || undefined });
  };

  return (
    <ScreenContainer
      title="Konverzace"
      headerLeft={<TorStatusBadge status={torStatus} progress={torProgress} />}
      headerRight={
        <button
          onClick={() => navigation.navigate('Profile')}
          style={{
            background: 'none',
            border: `1px solid ${Theme.colors.borderLight}`,
            borderRadius: Theme.radius.full,
            color: Theme.colors.textPrimary,
            fontSize: Theme.typography.sizes.md,
            cursor: 'pointer',
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          👤 Profil
        </button>
      }
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {conversations.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: Theme.spacing.xxl,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 48, marginBottom: Theme.spacing.md }}>💬</div>
            <h3
              style={{
                color: Theme.colors.textPrimary,
                fontSize: Theme.typography.sizes.lg,
                fontWeight: Theme.typography.weights.bold,
                margin: 0,
                marginBottom: Theme.spacing.xs,
              }}
            >
              Žádné konverzace
            </h3>
            <p
              style={{
                color: Theme.colors.textSecondary,
                fontSize: Theme.typography.sizes.sm,
                maxWidth: 280,
                margin: 0,
              }}
            >
              Naskenujte QR kód kontaktu nebo nasdílejte svůj profil a začněte bezpečnou komunikaci přes Tor.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {conversations.map((c) => (
              <ContactListItem
                key={c.contact.recipientPubkeyHash}
                contact={c.contact}
                lastMessage={c.lastMessage}
                unreadCount={c.unreadCount}
                onPress={() =>
                  handleSelectContact(c.contact.recipientPubkeyHash, c.contact.alias)
                }
              />
            ))}
          </div>
        )}

        {/* Floating Action Button (Add/Scan Contact) */}
        <button
          onClick={() => navigation.navigate('Scanner')}
          style={{
            position: 'fixed',
            bottom: Theme.spacing.xl,
            right: Theme.spacing.xl,
            width: 56,
            height: 56,
            borderRadius: Theme.radius.full,
            backgroundColor: Theme.colors.primary,
            color: '#000000',
            border: 'none',
            fontSize: 24,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 4px 14px ${Theme.colors.primaryGlow}`,
            cursor: 'pointer',
            zIndex: 100,
          }}
          title="Přidat kontakt / Naskenovat QR"
        >
          📷
        </button>
      </div>
    </ScreenContainer>
  );
};

