import React, { useState } from 'react';
import { useOrchestrator } from '../context/OrchestratorContext';
import { ChatListScreen } from '../screens/ChatListScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { RestoreSeedScreen } from '../screens/RestoreSeedScreen';
import { ScannerScreen } from '../screens/ScannerScreen';
import { SeedDisplayScreen } from '../screens/SeedDisplayScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { NavigationProp, ScreenName } from '../types';

export const RootNavigator: React.FC = () => {
  const { identity, isInitialized } = useOrchestrator();
  const [currentScreen, setCurrentScreen] = useState<ScreenName>(
    identity ? 'ChatList' : 'Welcome'
  );
  const [screenParams, setScreenParams] = useState<any>({});
  const [screenStack, setScreenStack] = useState<ScreenName[]>([]);

  // If identity is loaded from Keychain and we are on Welcome screen, advance to ChatList
  React.useEffect(() => {
    if (identity && (currentScreen === 'Welcome' || currentScreen === 'RestoreSeed')) {
      setCurrentScreen('ChatList');
    } else if (!identity && currentScreen !== 'Welcome' && currentScreen !== 'RestoreSeed' && currentScreen !== 'SeedDisplay') {
      setCurrentScreen('Welcome');
    }
  }, [identity]);

  const navigation: NavigationProp = {
    navigate: (screen: ScreenName, params?: any) => {
      setScreenStack((prev) => [...prev, currentScreen]);
      setScreenParams(params || {});
      setCurrentScreen(screen);
    },
    goBack: () => {
      if (screenStack.length > 0) {
        const prev = screenStack[screenStack.length - 1];
        setScreenStack((stack) => stack.slice(0, stack.length - 1));
        setCurrentScreen(prev);
      } else {
        setCurrentScreen(identity ? 'ChatList' : 'Welcome');
      }
    },
    reset: (screen: ScreenName) => {
      setScreenStack([]);
      setScreenParams({});
      setCurrentScreen(screen);
    },
  };

  if (!isInitialized) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#0D1117',
          color: '#10B981',
          fontSize: 18,
          fontWeight: 'bold',
        }}
      >
        Inicializace bezpečného úložiště...
      </div>
    );
  }

  switch (currentScreen) {
    case 'Welcome':
      return <WelcomeScreen navigation={navigation} />;
    case 'SeedDisplay':
      return (
        <SeedDisplayScreen
          mnemonic={screenParams.mnemonic || ''}
          navigation={navigation}
        />
      );
    case 'RestoreSeed':
      return <RestoreSeedScreen navigation={navigation} />;
    case 'ChatList':
      return <ChatListScreen navigation={navigation} />;
    case 'Chat':
      return (
        <ChatScreen
          contactPubkeyHash={screenParams.contactPubkeyHash}
          alias={screenParams.alias}
          navigation={navigation}
        />
      );
    case 'Profile':
      return <ProfileScreen navigation={navigation} />;
    case 'Scanner':
      return <ScannerScreen navigation={navigation} />;
    default:
      return <WelcomeScreen navigation={navigation} />;
  }
};

