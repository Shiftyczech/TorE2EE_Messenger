import React from 'react';
import { Theme } from '../theme';

export interface InputProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  style?: React.CSSProperties;
}

export const Input: React.FC<InputProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  disabled = false,
  multiline = false,
  rows = 3,
  style = {},
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', marginBottom: Theme.spacing.md }}>
      {label && (
        <label
          style={{
            fontSize: Theme.typography.sizes.sm,
            color: Theme.colors.textSecondary,
            fontWeight: Theme.typography.weights.medium,
            marginBottom: Theme.spacing.xs,
          }}
        >
          {label}
        </label>
      )}

      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          style={{
            backgroundColor: Theme.colors.surface,
            color: Theme.colors.textPrimary,
            border: `1px solid ${error ? Theme.colors.danger : Theme.colors.border}`,
            borderRadius: Theme.radius.md,
            padding: `${Theme.spacing.sm}px ${Theme.spacing.md}px`,
            fontSize: Theme.typography.sizes.md,
            fontFamily: 'inherit',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
            ...style,
          }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          style={{
            backgroundColor: Theme.colors.surface,
            color: Theme.colors.textPrimary,
            border: `1px solid ${error ? Theme.colors.danger : Theme.colors.border}`,
            borderRadius: Theme.radius.md,
            padding: `${Theme.spacing.sm}px ${Theme.spacing.md}px`,
            fontSize: Theme.typography.sizes.md,
            outline: 'none',
            boxSizing: 'border-box',
            ...style,
          }}
        />
      )}

      {error && (
        <span
          style={{
            color: Theme.colors.danger,
            fontSize: Theme.typography.sizes.xs,
            marginTop: Theme.spacing.xs,
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
};

