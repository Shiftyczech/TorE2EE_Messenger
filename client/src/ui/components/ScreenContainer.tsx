import React from 'react';
import { Theme } from '../theme';

export interface ScreenContainerProps {
  title?: string;
  headerRight?: React.ReactNode;
  headerLeft?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export const ScreenContainer: React.FC<ScreenContainerProps> = ({
  title,
  headerRight,
  headerLeft,
  children,
  style = {},
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '100vh',
        backgroundColor: Theme.colors.background,
        color: Theme.colors.textPrimary,
        fontFamily: Theme.typography.familySans,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {(title || headerLeft || headerRight) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `${Theme.spacing.md}px ${Theme.spacing.lg}px`,
            backgroundColor: Theme.colors.surface,
            borderBottom: `1px solid ${Theme.colors.border}`,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: Theme.spacing.sm }}>
            {headerLeft}
            {title && (
              <h1
                style={{
                  margin: 0,
                  fontSize: Theme.typography.sizes.lg,
                  fontWeight: Theme.typography.weights.bold,
                  color: Theme.colors.textPrimary,
                }}
              >
                {title}
              </h1>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: Theme.spacing.sm }}>
            {headerRight}
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  );
};

