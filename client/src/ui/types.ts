import { ContactRecord, StoredMessage } from '../storage/types';

export type ScreenName =
  | 'Welcome'
  | 'SeedDisplay'
  | 'RestoreSeed'
  | 'ChatList'
  | 'Chat'
  | 'Profile'
  | 'Scanner';

export type RootStackParamList = {
  Welcome: undefined;
  SeedDisplay: { mnemonic: string };
  RestoreSeed: undefined;
  ChatList: undefined;
  Chat: { contactPubkeyHash: string; alias?: string };
  Profile: undefined;
  Scanner: undefined;
};

export interface NavigationProp {
  navigate: (screen: ScreenName, params?: any) => void;
  goBack: () => void;
  reset: (screen: ScreenName) => void;
}

export interface ConversationSummary {
  contact: ContactRecord;
  lastMessage: StoredMessage | null;
  unreadCount: number;
}

