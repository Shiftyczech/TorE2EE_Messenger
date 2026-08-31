import React, { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { ScreenContainer } from '../components/ScreenContainer';
import { useOrchestrator } from '../context/OrchestratorContext';
import { Theme } from '../theme';
import { NavigationProp } from '../types';

export interface ScannerScreenProps {
  navigation: NavigationProp;
}

export const ScannerScreen: React.FC<ScannerScreenProps> = ({ navigation }) => {
  const { importContact, selectConversation } = useOrchestrator();
  const [uriInput, setUriInput] = useState('');
  const [aliasInput, setAliasInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!uriInput.trim()) return;
    setError(null);
    setLoading(true);

    try {
      const contact = await importContact(uriInput.trim(), aliasInput.trim() || undefined);
      await selectConversation(contact.recipientPubkeyHash);
      navigation.navigate('Chat', {
        contactPubkeyHash: contact.recipientPubkeyHash,
        alias: contact.alias || undefined,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer
      title="Přidat kontakt"
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
        {/* Camera Scanner View Simulation */}
        <div
          style={{
            width: '100%',
            height: 200,
            backgroundColor: Theme.colors.surfaceSecondary,
            border: `2px dashed ${Theme.colors.primary}`,
            borderRadius: Theme.radius.lg,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: Theme.spacing.md,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ fontSize: 36, marginBottom: Theme.spacing.xs }}>📷</div>
          <span
            style={{
              color: Theme.colors.textPrimary,
              fontSize: Theme.typography.sizes.sm,
              fontWeight: Theme.typography.weights.semibold,
            }}
          >
            Hledáček fotoaparátu pro QR kód
          </span>
          <span
            style={{
              color: Theme.colors.textMuted,
              fontSize: Theme.typography.sizes.xs,
              marginTop: Theme.spacing.xs,
            }}
          >
            Namiřte fotoaparát na QR kód přítele nebo vložte URI níže.
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: Theme.spacing.md }}>
          <Input
            label="Vložit Contact URI nebo Base64 kód"
            value={uriInput}
            onChangeText={setUriInput}
            placeholder="tore2ee://contact?v=1&d=..."
            multiline
            rows={3}
            error={error || undefined}
          />

          <Input
            label="Přezdívka kontaktu (volitelné)"
            value={aliasInput}
            onChangeText={setAliasInput}
            placeholder="např. Alice, Bob, Kolega..."
          />
        </div>

        <div style={{ marginTop: 'auto', paddingTop: Theme.spacing.lg }}>
          <Button
            title="Přidat kontakt a zahájit chat"
            onPress={handleImport}
            loading={loading}
            disabled={!uriInput.trim()}
            variant="primary"
          />
        </div>
      </div>
    </ScreenContainer>
  );
};

