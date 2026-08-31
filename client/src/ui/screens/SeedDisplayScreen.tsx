import React, { useState } from 'react';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { Theme } from '../theme';
import { NavigationProp } from '../types';

export interface SeedDisplayScreenProps {
  mnemonic: string;
  navigation: NavigationProp;
}

export const SeedDisplayScreen: React.FC<SeedDisplayScreenProps> = ({
  mnemonic,
  navigation,
}) => {
  const [confirmed, setConfirmed] = useState(false);
  const words = mnemonic.trim().split(/\s+/);

  return (
    <ScreenContainer
      title="Záloha vaší identity"
      style={{ padding: Theme.spacing.lg }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: Theme.spacing.lg }}>
        {/* Warning Banner */}
        <div
          style={{
            backgroundColor: Theme.colors.dangerSurface,
            border: `1px solid ${Theme.colors.danger}`,
            borderRadius: Theme.radius.md,
            padding: Theme.spacing.md,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: Theme.spacing.sm, marginBottom: Theme.spacing.xs }}>
            <span style={{ fontSize: Theme.typography.sizes.lg }}>⚠️</span>
            <span
              style={{
                color: Theme.colors.danger,
                fontWeight: Theme.typography.weights.bold,
                fontSize: Theme.typography.sizes.sm,
              }}
            >
              DŮLEŽITÉ BEZPEČNOSTNÍ UPOZORNĚNÍ
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: Theme.typography.sizes.xs,
              color: Theme.colors.textPrimary,
              lineHeight: 1.4,
            }}
          >
            Těchto 12 slov je váš jediný klíč. Pokud zařízení ztratíte a nemáte seed zapsaný na papíře,
            vaše identita ani zprávy nebudou moci být nikdy obnoveny.
          </p>
        </div>

        {/* Words Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: Theme.spacing.sm,
            backgroundColor: Theme.colors.surface,
            border: `1px solid ${Theme.colors.border}`,
            borderRadius: Theme.radius.lg,
            padding: Theme.spacing.md,
          }}
        >
          {words.map((word, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: Theme.colors.surfaceSecondary,
                border: `1px solid ${Theme.colors.borderLight}`,
                borderRadius: Theme.radius.sm,
                padding: `${Theme.spacing.sm}px ${Theme.spacing.sm}px`,
              }}
            >
              <span
                style={{
                  color: Theme.colors.textMuted,
                  fontSize: Theme.typography.sizes.xs,
                  width: 20,
                  flexShrink: 0,
                }}
              >
                {index + 1}.
              </span>
              <span
                style={{
                  color: Theme.colors.textPrimary,
                  fontSize: Theme.typography.sizes.sm,
                  fontWeight: Theme.typography.weights.semibold,
                  fontFamily: Theme.typography.familyMono,
                }}
              >
                {word}
              </span>
            </div>
          ))}
        </div>

        {/* Checkbox confirmation */}
        <div
          onClick={() => setConfirmed(!confirmed)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: Theme.spacing.md,
            cursor: 'pointer',
            backgroundColor: Theme.colors.surface,
            border: `1px solid ${Theme.colors.border}`,
            borderRadius: Theme.radius.md,
            padding: Theme.spacing.md,
            userSelect: 'none',
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: Theme.radius.sm,
              border: `2px solid ${confirmed ? Theme.colors.primary : Theme.colors.borderLight}`,
              backgroundColor: confirmed ? Theme.colors.primary : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#000000',
              fontWeight: 'bold',
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {confirmed && '✓'}
          </div>

          <span
            style={{
              fontSize: Theme.typography.sizes.sm,
              color: Theme.colors.textPrimary,
              fontWeight: Theme.typography.weights.medium,
            }}
          >
            Opsal(a) jsem si všech 12 slov a bezpečně je uložil(a).
          </span>
        </div>

        <div style={{ marginTop: 'auto', paddingTop: Theme.spacing.lg }}>
          <Button
            title="Vstoupit do aplikace"
            onPress={() => navigation.reset('ChatList')}
            disabled={!confirmed}
            variant="primary"
          />
        </div>
      </div>
    </ScreenContainer>
  );
};

