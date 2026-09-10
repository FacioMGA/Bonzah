import React, { useCallback, useEffect, useState } from 'react';
import { Button, Textarea } from '@/src/shared/ui';
import { accountsApiClient } from '@/src/modules/accounts/api/accountsApiClient';
import { logger } from '@/src/shared/lib/logger';

export type AccountClientNote = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null; email: string } | null;
};

type Props = {
  accountId: string;
};

function formatNoteTime(value: string): string {
  try {
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function authorLabel(note: AccountClientNote): string {
  const name = String(note.author?.name || '').trim();
  if (name) return name;
  const email = String(note.author?.email || '').trim();
  if (email) return email;
  return 'Staff';
}

export function AccountClientNotesTab({ accountId }: Props) {
  const [notes, setNotes] = useState<AccountClientNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await accountsApiClient.getAccount360Notes(accountId);
      if (res?.success) {
        setNotes(Array.isArray(res.data) ? (res.data as AccountClientNote[]) : []);
      } else {
        setError(String(res?.error?.message || 'Failed to load client notes'));
        setNotes([]);
      }
    } catch (err) {
      logger.error('Failed to load client notes', err);
      setError('Failed to load client notes');
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const handleSubmit = async () => {
    const trimmed = body.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await accountsApiClient.createAccount360Note(accountId, { body: trimmed });
      if (res?.success && res.data) {
        setBody('');
        setNotes((prev) => [...prev, res.data as AccountClientNote]);
      } else {
        setError(String(res?.error?.message || 'Failed to save note'));
      }
    } catch (err) {
      logger.error('Failed to save client note', err);
      setError('Failed to save note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="ui-card ui-card-pad">
        <div className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-2">Client notes</div>
        <p className="text-sm text-slate-600">
          Shared notes for all staff in this office. Add context that every team member should see on this client file.
        </p>
      </div>

      <div className="ui-table-wrap">
        <div className="px-10 py-6 bg-slate-50/60 border-b border-slate-200/60">
          <div className="text-xs font-black text-slate-600 uppercase tracking-widest">Notes history</div>
        </div>
        {loading ? (
          <div className="px-10 py-10 text-sm text-slate-500">Loading client notes…</div>
        ) : notes.length === 0 ? (
          <div className="px-10 py-10 text-sm text-slate-400">No client notes yet. Add the first note below.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notes.map((note) => (
              <div key={note.id} className="px-10 py-6">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="text-sm font-black text-slate-900">{authorLabel(note)}</div>
                  <div className="text-xs font-semibold text-slate-500">{formatNoteTime(note.createdAt)}</div>
                </div>
                <div className="text-sm text-slate-700 font-medium whitespace-pre-wrap">{note.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ui-card ui-card-pad space-y-4">
        <div className="text-xs font-black text-slate-600 uppercase tracking-widest">Add note</div>
        <Textarea
          className="min-h-[120px]"
          placeholder="Write a note for staff…"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={saving}
        />
        {error ? <div className="text-sm font-semibold text-rose-600">{error}</div> : null}
        <div className="flex justify-end">
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={saving || !body.trim()}
            onClick={() => { void handleSubmit(); }}
          >
            {saving ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      </div>
    </div>
  );
}
