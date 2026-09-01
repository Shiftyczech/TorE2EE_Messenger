import React from 'react';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { useOrchestrator } from '../context/OrchestratorContext';
import { Theme } from '../theme';
import { NavigationProp } from '../types';
import { BatteryOptimizationManager } from '../../native/BatteryOptimization';

export interface WelcomeScreenProps {
  navigation: NavigationProp;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ navigation }) => {
  const { createIdentity } = useOrchestrator();
  const [loading, setLoading] = React.useState(false);
  const [showBatteryModal, setShowBatteryModal] = React.useState(false);

  React.useEffect(() => {
    const checkBatteryOptimization = async () => {
      try {
        const isIgnoring = await BatteryOptimizationManager.isIgnoringBatteryOptimizations();
        if (!isIgnoring) {
          setShowBatteryModal(true);
        }
      } catch (e) {
        console.warn('Could not check battery optimization status:', e);
      }
    };

    checkBatteryOptimization();
  }, []);

  const handleRequestBatteryOptimization = async () => {
    try {
      await BatteryOptimizationManager.requestIgnoreBatteryOptimizations();
    } catch (e) {
      console.warn('Failed to trigger battery optimization dialog:', e);
    } finally {
      setShowBatteryModal(false);
    }
  };

  const handleDismissBatteryModal = () => {
    setShowBatteryModal(false);
  };

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
    <ScreenContainer style={{ justifyContent: 'center', padding: Theme.spacing.xl, position: 'relative' }}>
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

      {/* Battery Optimization Modal */}
      {showBatteryModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.82)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: Theme.spacing.lg,
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: Theme.colors.surface,
              border: `1px solid ${Theme.colors.primary}`,
              borderRadius: Theme.radius.lg,
              padding: Theme.spacing.xl,
              maxWidth: 400,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              boxShadow: `0 0 30px ${Theme.colors.primaryGlow}`,
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: Theme.radius.full,
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: `1px solid ${Theme.colors.primary}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 32,
                marginBottom: Theme.spacing.md,
              }}
            >
              🔋
            </div>

            <h2
              style={{
                fontSize: Theme.typography.sizes.lg,
                fontWeight: Theme.typography.weights.bold,
                color: Theme.colors.textPrimary,
                margin: 0,
                marginBottom: Theme.spacing.sm,
              }}
            >
              Optimalizace baterie
            </h2>

            <p
              style={{
                fontSize: Theme.typography.sizes.sm,
                color: Theme.colors.textPrimary,
                lineHeight: 1.5,
                margin: 0,
                marginBottom: Theme.spacing.sm,
              }}
            >
              Abychom mohli bezpečně doručovat zprávy přes anonymní síť Tor, aplikace potřebuje výjimku z optimalizace baterie.
            </p>

            <p
              style={{
                fontSize: Theme.typography.sizes.xs,
                color: Theme.colors.textSecondary,
                lineHeight: 1.4,
                margin: 0,
                marginBottom: Theme.spacing.xl,
              }}
            >
              Bez této výjimky systém Android uspat proces Tor démona a zprávy nebudou doručovány na pozadí.
            </p>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: Theme.spacing.sm,
                width: '100%',
              }}
            >
              <Button
                title="Povolit"
                onPress={handleRequestBatteryOptimization}
                variant="primary"
              />
              <Button
                title="Později"
                onPress={handleDismissBatteryModal}
                variant="ghost"
              />
            </div>
          </div>
        </div>
      )}
    </ScreenContainer>
  );
};
