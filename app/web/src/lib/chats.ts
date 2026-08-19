// Chat history, persisted the same way "recent digs" is: localStorage, this
// browser only, no server, no database — consistent with the no-persistence
// decision while still giving the history pane something real to list.
import type { ChatTurn } from "@/screens/ChatScreen";

export type StoredChat = {
  id: string;
  /** The first question, which is how a person recognises a conversation. */
  title: string;
  updatedAt: number;
  turns: ChatTurn[];
};

const KEY = "badger.chats.v1";
const KEEP = 20;

export function loadChats(): StoredChat[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveChats(chats: StoredChat[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(chats.slice(0, KEEP)));
  } catch {
    // Quota or private mode — history just doesn't persist.
  }
}

export function newChatId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
