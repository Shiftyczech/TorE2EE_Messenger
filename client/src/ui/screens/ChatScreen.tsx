import React, { useState, useRef, useEffect } from 'react';
import { MessageBubble } from '../components/MessageBubble';
import { ScreenContainer } from '../components/ScreenContainer';
import { useOrchestrator } from '../context/OrchestratorContext';
import { Theme } from '../theme';
import { NavigationProp } from '../types';

export interface ChatScreenProps {
  contactPubkeyHash: string;
  alias?: string;
  navigation: NavigationProp;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  contactPubkeyHash,
  alias,
  navigation,
}) => {
  const { activeMessages, activeContact, sendMessage, clearActiveConversation } =
    useOrchestrator();
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const displayName =
    alias ||
    activeContact?.alias ||
    `${contactPubkeyHash.substring(0, 8)}...${contactPubkeyHash.substring(
      contactPubkeyHash.length - 6
    )}`;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages]);

  const handleSend = async () => {
    if (!inputText.trim() || sending) return;
    const textToSend = inputText.trim();
    setInputText('');
    setSending(true);

    try {
      await sendMessage(textToSend);
    } catch {
      setInputText(textToSend);
    } finally {
      setSending(false);
    }
  };

  const handleBack = () => {
    clearActiveConversation();
    navigation.goBack();
  };

  return (
    <ScreenContainer
      title={displayName}
      headerLeft={
        <button
          onClick={handleBack}
          style={{
            background: 'none',
            border: 'none',
            color: Theme.colors.textSecondary,
            fontSize: Theme.typography.sizes.lg,
            cursor: 'pointer',
            padding: Theme.spacing.xs,
          }}
        >
          ←
        </button>
      }
      headerRight={
        <div
          style={{
            fontSize: Theme.typography.sizes.xs,
            color: Theme.colors.primary,
            fontFamily: Theme.typography.familyMono,
            backgroundColor: Theme.colors.surfaceSecondary,
            padding: '4px 8px',
            borderRadius: Theme.radius.sm,
            border: `1px solid ${Theme.colors.borderLight}`,
          }}
        >
          E2EE Active 🔒
        </div>
      }
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
        }}
      >
        {/* Messages Scroll Area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: Theme.spacing.md,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {activeMessages.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                color: Theme.colors.textMuted,
                fontSize: Theme.typography.sizes.sm,
              }}
            >
              Žádné předchozí zprávy. Napište první zprávu a odešlete ji přes Tor.
            </div>
          ) : (
            activeMessages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input Box */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: Theme.spacing.sm,
            padding: Theme.spacing.md,
            backgroundColor: Theme.colors.surface,
            borderTop: `1px solid ${Theme.colors.border}`,
          }}
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
            }}
            placeholder="Napište zašifrovanou zprávu..."
            style={{
              flex: 1,
              backgroundColor: Theme.colors.surfaceSecondary,
              color: Theme.colors.textPrimary,
              border: `1px solid ${Theme.colors.borderLight}`,
              borderRadius: Theme.radius.full,
              padding: `${Theme.spacing.sm}px ${Theme.spacing.md}px`,
              fontSize: Theme.typography.sizes.md,
              outline: 'none',
            }}
          />

          <button
            onClick={handleSend}
            disabled={!inputText.trim() || sending}
            style={{
              width: 40,
              height: 40,
              borderRadius: Theme.radius.full,
              backgroundColor:
                inputText.trim() && !sending
                  ? Theme.colors.primary
                  : Theme.colors.surfaceSecondary,
              color: inputText.trim() && !sending ? '#000000' : Theme.colors.textMuted,
              border: 'none',
              fontSize: Theme.typography.sizes.md,
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: inputText.trim() && !sending ? 'pointer' : 'not-allowed',
              flexShrink: 0,
            }}
          >
            ➤
          </button>
        </div>
      </div>
    </ScreenContainer>
  );
};

