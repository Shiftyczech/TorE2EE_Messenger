import React from 'react';
import { Theme } from '../theme';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: React.CSSProperties;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style = {},
}) => {
  const getBackgroundColor = () => {
    if (disabled) return Theme.colors.surfaceSecondary;
    switch (variant) {
      case 'primary':
        return Theme.colors.primary;
      case 'secondary':
        return Theme.colors.surfaceSecondary;
      case 'danger':
        return Theme.colors.danger;
      case 'ghost':
        return 'transparent';
    }
  };

  const getTextColor = () => {
    if (disabled) return Theme.colors.textMuted;
    switch (variant) {
      case 'primary':
        return '#000000';
      case 'secondary':
      case 'ghost':
        return Theme.colors.textPrimary;
      case 'danger':
        return '#FFFFFF';
    }
  };

  const getBorder = () => {
    if (variant === 'secondary') return `1px solid ${Theme.colors.border}`;
    if (variant === 'ghost') return 'none';
    return 'none';
  };

  return (
    <button
      onClick={onPress}
      disabled={disabled || loading}
      style={{
        backgroundColor: getBackgroundColor(),
        color: getTextColor(),
        border: getBorder(),
        padding: `${Theme.spacing.md}px ${Theme.spacing.xl}px`,
        borderRadius: Theme.radius.md,
        fontSize: Theme.typography.sizes.md,
        fontWeight: Theme.typography.weights.semibold,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        boxSizing: 'border-box',
        transition: 'all 0.15s ease',
        ...style,
      }}
    >
      {loading ? 'Čekejte...' : title}
    </button>
  );
};

