export type ClientDoc = {
  id: string;
  name: string;
  entityType: 'quote' | 'policy' | 'claim' | 'profile';
  entityId: string;
  status?: 'Uploaded' | 'Pending review' | 'Approved' | 'Rejected';
  url: string;
  uploadedAt: string;
  uploadedBy?: string;
  rejectionReason?: string;
};

export type ClientFeedItem = {
  id: string;
  at: string;
  type: 'quote' | 'policy' | 'document' | 'billing' | 'claim' | 'message';
  title: string;
  detail?: string;
  href?: string;
};

const DOCS_KEY = 'facio_client_docs_v1';
const FEED_KEY = 'facio_client_feed_v1';

export function readClientDocs(): ClientDoc[] {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeClientDocs(next: ClientDoc[]) {
  localStorage.setItem(DOCS_KEY, JSON.stringify(next));
}

export function addClientDoc(doc: ClientDoc) {
  const curr = readClientDocs();
  writeClientDocs([doc, ...curr]);
}

export function readClientFeed(): ClientFeedItem[] {
  try {
    const raw = localStorage.getItem(FEED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeClientFeed(next: ClientFeedItem[]) {
  localStorage.setItem(FEED_KEY, JSON.stringify(next));
}

export function pushClientFeed(item: Omit<ClientFeedItem, 'id' | 'at'> & { id?: string; at?: string }) {
  const curr = readClientFeed();
  const next: ClientFeedItem = {
    id: item.id || `feed_${Date.now()}`,
    at: item.at || new Date().toISOString(),
    type: item.type,
    title: item.title,
    detail: item.detail,
    href: item.href,
  };
  writeClientFeed([next, ...curr].slice(0, 50));
}

