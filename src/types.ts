export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  isError?: boolean;
}

export interface StreamingMessage {
  text: string;
  thinking: string;
}
