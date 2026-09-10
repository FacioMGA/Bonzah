import { describe, expect, it } from 'vitest';
import {
  filterOfficeMessages,
  filterOfficeThreads,
  isOfficeMessageVisibleTo,
  officeViewerFromUser,
} from '../officeMessageVisibility.js';

const peter = { id: 'user_peter', email: 'peter@abbeygate.cy' };
const effie = { id: 'user_effie', email: 'effie@abbeygate.cy' };
const danny = { id: 'user_danny', email: 'danny@abbeygate.cy' };

const peterToEffie = {
  id: 'msg_dm',
  fromActor: peter.id,
  toRecipients: [effie.email],
  body: 'Private staff note',
};

describe('officeMessageVisibility (ABY-431)', () => {
  it('lets only the two participants see a staff DM', () => {
    expect(isOfficeMessageVisibleTo(peterToEffie, peter)).toBe(true);
    expect(isOfficeMessageVisibleTo(peterToEffie, effie)).toBe(true);
    expect(isOfficeMessageVisibleTo(peterToEffie, danny)).toBe(false);
  });

  it('matches a recipient stored as a user id', () => {
    const byId = { fromActor: peter.id, toRecipients: [effie.id] };
    expect(isOfficeMessageVisibleTo(byId, effie)).toBe(true);
    expect(isOfficeMessageVisibleTo(byId, danny)).toBe(false);
  });

  it('does not return other people\'s DMs from an office list', () => {
    const visible = filterOfficeMessages(
      [peterToEffie, { fromActor: danny.id, toRecipients: [peter.email], body: 'Danny to Peter' }],
      danny,
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]?.fromActor).toBe(danny.id);
  });

  it('drops OFFICE threads that have no remaining visible messages', () => {
    const threads = filterOfficeThreads(
      [{ id: 'thr_1', messages: [peterToEffie] }],
      danny,
    );
    expect(threads).toEqual([]);
  });

  it('builds a viewer from the authenticated user or fails closed', () => {
    expect(officeViewerFromUser({ id: peter.id, email: peter.email })).toEqual(peter);
    expect(officeViewerFromUser({ id: '', email: peter.email })).toBeNull();
    expect(officeViewerFromUser(null)).toBeNull();
  });
});
