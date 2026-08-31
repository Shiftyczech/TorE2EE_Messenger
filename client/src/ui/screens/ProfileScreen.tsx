import React, { useState, useEffect } from 'react';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { useOrchestrator } from '../context/OrchestratorContext';
import { Theme } from '../theme';
import { NavigationProp } from '../types';

export interface ProfileScreenProps {
  navigation: NavigationProp;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ navigation }) => {
  const { identity, exportOwnUri, logout } = useOrchestrator();
  const [uri, setUri] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadUri() {
      try {
        const exported = await exportOwnUri();
        setUri(exported);
      } catch {
        // Handle error
      } finally {
        setLoading(false);
      }
    }
    loadUri();
  }, [exportOwnUri]);

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigation.reset('Welcome');
  };

  return (
    <ScreenContainer
      title="Můj profil & QR kód"
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
        {/* QR Code Container */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: Theme.colors.surface,
            border: `1px solid ${Theme.colors.border}`,
            borderRadius: Theme.radius.lg,
            padding: Theme.spacing.lg,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 180,
              height: 180,
              backgroundColor: '#FFFFFF',
              borderRadius: Theme.radius.md,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: Theme.spacing.md,
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              padding: Theme.spacing.sm,
              boxSizing: 'border-box',
            }}
          >
            {/* Visual simulation of QR matrix */}
            <div
              style={{
                width: '100%',
                height: '100%',
                backgroundColor: '#000000',
                borderRadius: Theme.radius.sm,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontSize: Theme.typography.sizes.xs,
                textAlign: 'center',
                fontFamily: Theme.typography.familyMono,
                wordBreak: 'break-all',
                padding: 4,
                overflow: 'hidden',
              }}
            >
              {loading ? 'Generuji QR kód...' : 'QR CODE: TORE2EE IDENTITA'}
            </div>
          </div>

          <h3
            style={{
              color: Theme.colors.textPrimary,
              fontSize: Theme.typography.sizes.md,
              fontWeight: Theme.typography.weights.semibold,
              margin: 0,
              marginBottom: Theme.spacing.xs,
            }}
          >
            Naskenujte pro zahájení chatu
          </h3>

          <p
            style={{
              color: Theme.colors.textSecondary,
              fontSize: Theme.typography.sizes.xs,
              margin: 0,
              marginBottom: Theme.spacing.md,
            }}
          >
            Obsahuje váš veřejný Ed25519 klíč a X3DH Signed PreKey.
          </p>

          <Button
            title={copied ? '✓ Zkopírováno do schránky' : 'Kopírovat odkaz (URI)'}
            onPress={handleCopy}
            variant="secondary"
            disabled={!uri}
          />
        </div>

        {/* Identity Keys Details */}
        <div
          style={{
            backgroundColor: Theme.colors.surface,
            border: `1px solid ${Theme.colors.border}`,
            borderRadius: Theme.radius.lg,
            padding: Theme.spacing.md,
          }}
        >
          <h4
            style={{
              color: Theme.colors.primary,
              fontSize: Theme.typography.sizes.xs,
              textTransform: 'uppercase',
              letterSpacing: 1,
              margin: 0,
              marginBottom: Theme.spacing.sm,
            }}
          >
            Mailbox Hash (Relay ID)
          </h4>
          <p
            style={{
              margin: 0,
              fontFamily: Theme.typography.familyMono,
              fontSize: Theme.typography.sizes.xs,
              color: Theme.colors.textPrimary,
              wordBreak: 'break-all',
              backgroundColor: Theme.colors.surfaceSecondary,
              padding: Theme.spacing.sm,
              borderRadius: Theme.radius.sm,
            }}
          >
            {identity?.recipientPubkeyHash || '...'}
          </p>
        </div>

        {/* Logout / Reset Button */}
        <div style={{ marginTop: 'auto', paddingTop: Theme.spacing.lg }}>
          <Button
            title="Odhlásit se a smazat klíče z Keychain"
            onPress={handleLogout}
            variant="danger"
          />
        </div>
      </div>
    </ScreenContainer>
  );
};

