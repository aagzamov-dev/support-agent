import client from './client';

export async function listTickets(team?: string, status?: string) {
  const params: Record<string, string> = {};
  if (team) params.team = team;
  if (status) params.status = status;
  const { data } = await client.get('/api/tickets', { params });
  return data as { tickets: Record<string, unknown>[] };
}

export async function getTicket(id: string) {
  const { data } = await client.get(`/api/tickets/${id}`);
  return data;
}

export async function updateTicket(id: string, updates: Record<string, string>) {
  const { data } = await client.patch(`/api/tickets/${id}`, updates);
  return data;
}

export async function listUserTickets(sessionId: string) {
  const { data } = await client.get(`/api/user/tickets?session_id=${sessionId}`);
  return data as { tickets: Record<string, unknown>[] };
}

export async function createTicket(title: string, channel: string, sessionId: string, team = 'help_desk') {
  const { data } = await client.post(`/api/tickets/create?title=${encodeURIComponent(title)}&channel=${encodeURIComponent(channel)}&created_by=${encodeURIComponent(sessionId)}&team=${encodeURIComponent(team)}`);
  return data as Record<string, unknown>;
}
