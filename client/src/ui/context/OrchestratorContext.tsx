import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { IdentityManager } from '../../identity/IdentityManager';
import { UserIdentity } from '../../identity/types';
import { TorStatus, WsClientState } from '../../network/types';
import { AppOrchestrator } from '../../orchestration/AppOrchestrator';
import { ContactExchange } from '../../orchestration/ContactExchange';
import { ContactRecord, StoredMessage } from '../../storage/types';
import { ConversationSummary } from '../types';

export interface OrchestratorContextType {
  identity: UserIdentity | null;
  isInitialized: boolean;
  torStatus: TorStatus;
  torProgress: number;
  wsState: WsClientState;
  contacts: ContactRecord[];
  conversations: ConversationSummary[];
  unreadTotal: number;
  activeContact: ContactRecord | null;
  activeMessages: StoredMessage[];
  error: string | null;

  createIdentity: (words?: 12 | 24) => Promise<UserIdentity>;
  restoreIdentity: (mnemonic: string) => Promise<UserIdentity>;
  logout: () => Promise<void>;
  loadContacts: () => Promise<void>;
  selectConversation: (contactPubkeyHash: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  importContact: (uri: string, customAlias?: string) => Promise<ContactRecord>;
  exportOwnUri: (alias?: string) => Promise<string>;
  clearActiveConversation: () => void;
  clearError: () => void;
}

const OrchestratorContext = createContext<OrchestratorContextType | null>(null);

export interface OrchestratorProviderProps {
  children: React.ReactNode;
  initialIdentity?: UserIdentity | null;
  devMode?: boolean;
}

export const OrchestratorProvider: React.FC<OrchestratorProviderProps> = ({
  children,
  initialIdentity = null,
  devMode = false,
}) => {
  const [identity, setIdentity] = useState<UserIdentity | null>(initialIdentity);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [torStatus, setTorStatus] = useState<TorStatus>(TorStatus.NOT_INITIALIZED);
  const [torProgress, setTorProgress] = useState<number>(0);
  const [wsState, setWsState] = useState<WsClientState>(WsClientState.DISCONNECTED);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [unreadTotal, setUnreadTotal] = useState<number>(0);
  const [activeContact, setActiveContact] = useState<ContactRecord | null>(null);
  const [activeMessages, setActiveMessages] = useState<StoredMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const orchestratorRef = useRef<AppOrchestrator | null>(null);

  // Initialize identity from Keychain on startup
  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        if (!initialIdentity) {
          const loaded = await IdentityManager.loadIdentityFromKeychain();
          if (isMounted && loaded) {
            setIdentity(loaded);
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(`Keychain load error: ${(err as Error).message}`);
        }
      } finally {
        if (isMounted) {
          setIsInitialized(true);
        }
      }
    }

    init();
    return () => {
      isMounted = false;
    };
  }, [initialIdentity]);

  // Launch AppOrchestrator when identity changes
  useEffect(() => {
    let isMounted = true;

    if (!identity) {
      if (orchestratorRef.current) {
        orchestratorRef.current.stop();
        orchestratorRef.current = null;
      }
      return;
    }

    async function startOrchestrator() {
      try {
        const orchestrator = new AppOrchestrator(identity!, {
          torConfig: {
            socksProxyHost: '127.0.0.1',
            socksProxyPort: 9050,
            targetHost: '127.0.0.1',
            targetPort: 8080,
            devMode,
          },
          databaseConfig: {
            name: `tore2ee_${identity!.recipientPubkeyHash.substring(0, 8)}.db`,
          },
          events: {
            onTorStatusChanged: (status) => {
              if (isMounted) {
                setTorStatus(status);
                if (status === TorStatus.READY) setTorProgress(100);
              }
            },
            onWsStateChanged: (state) => {
              if (isMounted) setWsState(state);
            },
            onMessageReceived: async (msg) => {
              if (isMounted) {
                // If message belongs to active conversation, append
                if (activeContact && msg.contactPubkeyHash === activeContact.recipientPubkeyHash) {
                  setActiveMessages((prev) => [...prev, msg]);
                }
                await refreshConversations(orchestrator);
              }
            },
            onMessageSent: async (msg) => {
              if (isMounted) {
                if (activeContact && msg.contactPubkeyHash === activeContact.recipientPubkeyHash) {
                  setActiveMessages((prev) => [...prev, msg]);
                }
                await refreshConversations(orchestrator);
              }
            },
            onMessageStatusChanged: (msgId, status) => {
              if (isMounted) {
                setActiveMessages((prev) =>
                  prev.map((m) => (m.id === msgId ? { ...m, deliveryStatus: status } : m))
                );
              }
            },
            onError: (err) => {
              if (isMounted) setError(err.message);
            },
          },
        });

        await orchestrator.initialize();
        orchestratorRef.current = orchestrator;

        if (isMounted) {
          await refreshConversations(orchestrator);
        }

        await orchestrator.start();
      } catch (err) {
        if (isMounted) {
          setError(`Orchestrator start error: ${(err as Error).message}`);
        }
      }
    }

    startOrchestrator();

    return () => {
      isMounted = false;
      if (orchestratorRef.current) {
        orchestratorRef.current.stop();
        orchestratorRef.current = null;
      }
    };
  }, [identity, devMode]);

  async function refreshConversations(orchestrator: AppOrchestrator) {
    try {
      const contactList = await orchestrator.getContactRepository().listContacts();
      const messageRepo = orchestrator.getMessageRepository();

      const summaries: ConversationSummary[] = [];
      for (const contact of contactList) {
        const msgs = await messageRepo.getMessagesForContact(contact.recipientPubkeyHash, 1);
        const unread = await messageRepo.getUnreadCount(contact.recipientPubkeyHash);
        summaries.push({
          contact,
          lastMessage: msgs.length > 0 ? msgs[msgs.length - 1] : null,
          unreadCount: unread,
        });
      }

      const totalUnread = await messageRepo.getUnreadCount();

      setContacts(contactList);
      setConversations(summaries);
      setUnreadTotal(totalUnread);
    } catch {
      // Ignore refresh error
    }
  }

  const createIdentity = async (words: 12 | 24 = 12): Promise<UserIdentity> => {
    const newIdentity = await IdentityManager.generateIdentity(words);
    await IdentityManager.saveIdentityToKeychain(newIdentity);
    setIdentity(newIdentity);
    return newIdentity;
  };

  const restoreIdentity = async (mnemonic: string): Promise<UserIdentity> => {
    const restored = await IdentityManager.restoreIdentity(mnemonic);
    await IdentityManager.saveIdentityToKeychain(restored);
    setIdentity(restored);
    return restored;
  };

  const logout = async (): Promise<void> => {
    await IdentityManager.clearIdentityFromKeychain();
    if (orchestratorRef.current) {
      await orchestratorRef.current.stop();
      orchestratorRef.current = null;
    }
    setIdentity(null);
    setActiveContact(null);
    setActiveMessages([]);
    setConversations([]);
    setContacts([]);
  };

  const loadContacts = async (): Promise<void> => {
    if (orchestratorRef.current) {
      await refreshConversations(orchestratorRef.current);
    }
  };

  const selectConversation = async (contactPubkeyHash: string): Promise<void> => {
    if (!orchestratorRef.current) return;

    const contact = await orchestratorRef.current
      .getContactRepository()
      .getContactByHash(contactPubkeyHash);

    if (!contact) {
      throw new Error('Contact not found');
    }

    setActiveContact(contact);
    const messages = await orchestratorRef.current
      .getMessageRepository()
      .getMessagesForContact(contactPubkeyHash, 100);

    setActiveMessages(messages);

    // Mark messages as read
    await orchestratorRef.current.getMessageRepository().markMessagesAsRead(contactPubkeyHash);
    await refreshConversations(orchestratorRef.current);
  };

  const sendMessage = async (text: string): Promise<void> => {
    if (!orchestratorRef.current || !activeContact) {
      throw new Error('No active conversation');
    }
    await orchestratorRef.current.sendOutboundMessage(
      activeContact.recipientPubkeyHash,
      text
    );
  };

  const importContact = async (
    uri: string,
    customAlias?: string
  ): Promise<ContactRecord> => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }
    const imported = await ContactExchange.importContact(
      uri,
      orchestratorRef.current.getContactRepository(),
      orchestratorRef.current.getCryptoEngine(),
      customAlias
    );
    await refreshConversations(orchestratorRef.current);
    return imported;
  };

  const exportOwnUri = async (alias?: string): Promise<string> => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }
    const bundle = await orchestratorRef.current.generatePreKeyBundle(10);
    return ContactExchange.exportContactUri(bundle, alias);
  };

  const clearActiveConversation = (): void => {
    setActiveContact(null);
    setActiveMessages([]);
  };

  const clearError = (): void => {
    setError(null);
  };

  return (
    <OrchestratorContext.Provider
      value={{
        identity,
        isInitialized,
        torStatus,
        torProgress,
        wsState,
        contacts,
        conversations,
        unreadTotal,
        activeContact,
        activeMessages,
        error,
        createIdentity,
        restoreIdentity,
        logout,
        loadContacts,
        selectConversation,
        sendMessage,
        importContact,
        exportOwnUri,
        clearActiveConversation,
        clearError,
      }}
    >
      {children}
    </OrchestratorContext.Provider>
  );
};

export const useOrchestrator = (): OrchestratorContextType => {
  const context = useContext(OrchestratorContext);
  if (!context) {
    throw new Error('useOrchestrator must be used within an OrchestratorProvider');
  }
  return context;
};

