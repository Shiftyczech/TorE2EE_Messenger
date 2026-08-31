import React, { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { ScreenContainer } from '../components/ScreenContainer';
import { useOrchestrator } from '../context/OrchestratorContext';
import { Theme } from '../theme';
import { NavigationProp } from '../types';

export interface RestoreSeedScreenProps {
  navigation: NavigationProp;
}

export const RestoreSeedScreen: React.FC<RestoreSeedScreenProps> = ({ navigation }) => {
  const { restoreIdentity } = useOrchestrator();
  const [mnemonic, setMnemonic] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRestore = async () => {
    setError(null);
    setLoading(true);
    try {
      await restoreIdentity(mnemonic);
      navigation.reset('ChatList');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer
      title="Obnova identity"
      headerLeft={
        <button
          onClick={() => navigation.goBack()}
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
      style={{ padding: Theme.spacing.lg }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: Theme.spacing.lg }}>
        <p
          style={{
            margin: 0,
            fontSize: Theme.typography.sizes.sm,
            color: Theme.colors.textSecondary,
            lineHeight: 1.5,
          }}
        >
          Zadejte 12 nebo 24 slov vaší seed phrase oddělených mezerou. Vaše šifrovací klíče a
          identita budou deterministicky obnoveny.
        </p>

        <Input
          label="BIP-39 Mnemonic Seed"
          value={mnemonic}
          onChangeText={setMnemonic}
          placeholder="např. abandon abandon abandon abandon abandon..."
          multiline
          rows={4}
          error={error || undefined}
        />

        <div style={{ marginTop: 'auto', paddingTop: Theme.spacing.lg }}>
          <Button
            title="Obnovit identitu"
            onPress={handleRestore}
            loading={loading}
            disabled={!mnemonic.trim()}
            variant="primary"
          />
        </div>
      </div>
    </ScreenContainer>
  );
};

