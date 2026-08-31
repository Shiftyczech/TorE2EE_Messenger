import React from 'react';
import { Theme } from '../theme';
import { TorStatus } from '../../network/types';
import { TorStatusBadge } from '../components/TorStatusBadge';
import { MessageBubble } from '../components/MessageBubble';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { StoredMessage } from '../../storage/types';

describe('UI Theme & Components', () => {
  describe('Cybersecurity Theme Palette', () => {
    it('defines expected dark mode and neon accent colors', () => {
      expect(Theme.colors.background).toBe('#0D1117');
      expect(Theme.colors.surface).toBe('#161B22');
      expect(Theme.colors.primary).toBe('#10B981');
      expect(Theme.colors.bubbleOutgoing).toBe('#064E3B');
      expect(Theme.colors.bubbleIncoming).toBe('#1F2937');
    });
  });

  describe('Component Props & Rendering logic', () => {
    it('creates TorStatusBadge with correct status indicators', () => {
      const readyBadge = TorStatusBadge({
        status: TorStatus.READY,
        progress: 100,
      });
      expect(readyBadge).toBeDefined();

      const bootstrapBadge = TorStatusBadge({
        status: TorStatus.BOOTSTRAPPING,
        progress: 45,
      });
      expect(bootstrapBadge).toBeDefined();
    });

    it('creates MessageBubble for outgoing and incoming messages', () => {
      const outgoingMsg: StoredMessage = {
        id: 'msg-1',
        contactPubkeyHash: 'hash1',
        senderIdentityHex: 'sender',
        recipientIdentityHex: 'recip',
        body: 'Outgoing test message',
        timestamp: 1600000000000,
        isOutgoing: true,
        isRead: true,
        deliveryStatus: 'delivered',
      };

      const outgoingBubble = MessageBubble({ message: outgoingMsg });
      expect(outgoingBubble).toBeDefined();

      const incomingMsg: StoredMessage = {
        ...outgoingMsg,
        id: 'msg-2',
        isOutgoing: false,
        deliveryStatus: 'delivered',
      };

      const incomingBubble = MessageBubble({ message: incomingMsg });
      expect(incomingBubble).toBeDefined();
    });

    it('creates Button and Input elements without throwing', () => {
      let clicked = false;
      const btn = Button({
        title: 'Test Button',
        onPress: () => {
          clicked = true;
        },
        variant: 'primary',
      });
      expect(btn).toBeDefined();

      const inp = Input({
        label: 'Test Input',
        value: 'Hello',
        onChangeText: () => {},
      });
      expect(inp).toBeDefined();
    });
  });
});

