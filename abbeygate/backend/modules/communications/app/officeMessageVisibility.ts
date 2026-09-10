/**
 * Office (staff-to-staff) message visibility.
 *
 * Canonical owner for ABY-431: OFFICE threads are private between the
 * participants. A viewer sees a message only when they sent it or they
 * are named in toRecipients. No admin override — staff DMs stay between
 * the two people.
 */

export type OfficeViewer = {
  id: string;
  email?: string | null;
};

export type OfficeMessageActors = {
  fromActor?: string | null;
  toRecipients?: unknown;
};

function normalizeActor(value: unknown): string {
  return String(value || '').trim();
}

function recipientList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeActor(entry)).filter(Boolean);
}

export function officeViewerFromUser(user: {
  id?: string | null;
  email?: unknown;
} | null | undefined): OfficeViewer | null {
  const id = String(user?.id || '').trim();
  if (!id) return null;
  const email = typeof user?.email === 'string' ? user.email.trim() : '';
  return { id, email: email || null };
}

export function isOfficeMessageVisibleTo(
  message: OfficeMessageActors,
  viewer: OfficeViewer,
): boolean {
  const viewerId = normalizeActor(viewer.id);
  if (!viewerId) return false;

  const fromActor = normalizeActor(message.fromActor);
  if (fromActor && fromActor === viewerId) return true;

  const viewerEmail = normalizeActor(viewer.email).toLowerCase();
  if (fromActor && viewerEmail && fromActor.toLowerCase() === viewerEmail) return true;

  return recipientList(message.toRecipients).some((recipient) => {
    if (recipient === viewerId) return true;
    return Boolean(viewerEmail && recipient.toLowerCase() === viewerEmail);
  });
}

export function filterOfficeMessages<T extends OfficeMessageActors>(
  messages: T[],
  viewer: OfficeViewer,
): T[] {
  return messages.filter((message) => isOfficeMessageVisibleTo(message, viewer));
}

export function filterOfficeThreads<T extends { messages: OfficeMessageActors[] }>(
  threads: T[],
  viewer: OfficeViewer,
): Array<T & { messages: T['messages'] }> {
  return threads
    .map((thread) => ({
      ...thread,
      messages: filterOfficeMessages(thread.messages, viewer),
    }))
    .filter((thread) => thread.messages.length > 0);
}
