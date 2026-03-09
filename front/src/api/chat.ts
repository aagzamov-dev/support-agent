import client from './client';

export async function sendMessage(message: string, channel = 'chat', ticket_id = '', session_id = '') {
  const { data } = await client.post('/api/chat', { message, channel, ticket_id, session_id });
  return data as { reply: string; ticket: Record<string, unknown> | null; kb_results_count: number; message_id: string | number | null };
}

export async function transcribeVoice(audio: Blob, ticket_id = '', session_id = '') {
  const fd = new FormData();
  fd.append('audio', audio, 'recording.webm');
  if (ticket_id) fd.append('ticket_id', ticket_id);
  if (session_id) fd.append('session_id', session_id);
  const { data } = await client.post('/api/voice/transcribe', fd);
  return data as { transcript: string; reply: string; ticket: Record<string, unknown> | null; message_id: string | number | null };
}

export async function sendFeedback(ticket_id: string, score: number, text?: string) {
  const { data } = await client.post(`/api/tickets/${ticket_id}/feedback`, { score, text });
  return data;
}

export async function sendReply(ticket_id: string, message: string) {
  const { data } = await client.post(`/api/tickets/${ticket_id}/reply`, { message });
  return data;
}
