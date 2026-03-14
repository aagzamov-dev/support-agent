import client from './client';

export async function searchKB(q: string) {
  const { data } = await client.get('/api/kb/search', { params: { q } });
  return data;
}

export async function listDocuments() {
  const { data } = await client.get('/api/kb/documents');
  return data;
}

export async function getDocument(id: string) {
  const { data } = await client.get(`/api/kb/documents/${id}`);
  return data;
}

export async function createDocument(doc: { title: string; category: string; tags: string[]; sections: { heading: string; content: string }[] }) {
  const { data } = await client.post('/api/kb/documents', doc);
  return data;
}

export async function updateDocument(id: string, doc: Record<string, unknown>) {
  const { data } = await client.put(`/api/kb/documents/${id}`, doc);
  return data;
}

export async function deleteDocument(id: string) {
  const { data } = await client.delete(`/api/kb/documents/${id}`);
  return data;
}

export async function reindexKB() {
  const { data } = await client.post('/api/kb/reindex');
  return data;
}

export async function uploadPDF(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await client.post('/api/kb/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
