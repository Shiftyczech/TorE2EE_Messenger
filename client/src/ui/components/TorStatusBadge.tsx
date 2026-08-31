import React from 'react';
import { TorStatus } from '../../network/types';
import { Theme } from '../theme';

export interface TorStatusBadgeProps {
  status: TorStatus;
  progress?: number;
  onPress?: () => void;
}

export const TorStatusBadge: React.FC<TorStatusBadgeProps> = ({
  status,
  progress = 0,
  onPress,
}) => {
  const getStatusConfig = () => {
    switch (status) {
      case TorStatus.READY:
        return {
          color: Theme.colors.primary,
          bg: Theme.colors.primaryGlow,
          text: 'Tor: Zabezpečeno',
          dot: '●',
        };
      case TorStatus.BOOTSTRAPPING:
        return {
          color: Theme.colors.warning,
          bg: Theme.colors.warningSurface,
          text: `Tor: Navazování okruhu (${progress}%)`,
          dot: '◐',
        };
      case TorStatus.ERROR:
        return {
          color: Theme.colors.danger,
          bg: Theme.colors.dangerSurface,
          text: 'Tor: Chyba připojení',
          dot: '✕',
        };
      case TorStatus.STOPPED:
      case TorStatus.NOT_INITIALIZED:
      default:
        return {
          color: Theme.colors.textMuted,
          bg: Theme.colors.surfaceSecondary,
          text: 'Tor: Odpojeno',
          dot: '○',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div
      onClick={onPress}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Theme.spacing.xs,
        padding: `3px ${Theme.spacing.sm}px`,
        backgroundColor: config.bg,
        border: `1px solid ${config.color}`,
        borderRadius: Theme.radius.full,
        cursor: onPress ? 'pointer' : 'default',
        userSelect: 'none',
      }}
    >
      <span style={{ color: config.color, fontSize: Theme.typography.sizes.sm }}>
        {config.dot}
      </span>
      <span
        style={{
          color: Theme.colors.textPrimary,
          fontSize: Theme.typography.sizes.xs,
          fontWeight: Theme.typography.weights.medium,
        }}
      >
        {config.text}
      </span>
    </div>
  );
};

