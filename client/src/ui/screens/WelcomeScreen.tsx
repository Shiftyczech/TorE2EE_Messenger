import React from 'react';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { useOrchestrator } from '../context/OrchestratorContext';
import { Theme } from '../theme';
import { NavigationProp } from '../types';

export interface WelcomeScreenProps {
  navigation: NavigationProp;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ navigation }) => {
  const { createIdentity } = useOrchestrator();
  const [loading, setLoading] = React.useState(false);

  const handleCreateIdentity = async () => {
    setLoading(true);
    try {
      const identity = await createIdentity(12);
      navigation.navigate('SeedDisplay', { mnemonic: identity.mnemonic });
    } catch {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer style={{ justifyContent: 'center', padding: Theme.spacing.xl }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          marginBottom: Theme.spacing.xxl,
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: Theme.radius.full,
            backgroundColor: Theme.colors.surfaceSecondary,
            border: `2px solid ${Theme.colors.primary}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 40,
            marginBottom: Theme.spacing.lg,
            boxShadow: `0 0 20px ${Theme.colors.primaryGlow}`,
          }}
        >
          🛡️
        </div>

        <h1
          style={{
            fontSize: Theme.typography.sizes.xxl,
            fontWeight: Theme.typography.weights.bold,
            color: Theme.colors.textPrimary,
            margin: 0,
            marginBottom: Theme.spacing.xs,
          }}
        >
          TorE2EE Messenger
        </h1>

        <p
          style={{
            fontSize: Theme.typography.sizes.sm,
            color: Theme.colors.primary,
            fontWeight: Theme.typography.weights.medium,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            margin: 0,
            marginBottom: Theme.spacing.md,
          }}
        >
          Zero-Knowledge • Signal Double Ratchet • Tor v3
        </p>

        <p
          style={{
            fontSize: Theme.typography.sizes.sm,
            color: Theme.colors.textSecondary,
            lineHeight: 1.5,
            maxWidth: 320,
            margin: 0,
          }}
        >
          Žádná telefonní čísla. Žádné e-maily. Žádné servery sledující vaše zprávy. Veškerý provoz
          teče přes síť Tor.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: Theme.spacing.md, width: '100%' }}>
        <Button
          title="Vytvořit novou identitu"
          onPress={handleCreateIdentity}
          loading={loading}
          variant="primary"
        />

        <Button
          title="Obnovit identitu ze seedu"
          onPress={() => navigation.navigate('RestoreSeed')}
          variant="secondary"
        />
      </div>
    </ScreenContainer>
  );
};

