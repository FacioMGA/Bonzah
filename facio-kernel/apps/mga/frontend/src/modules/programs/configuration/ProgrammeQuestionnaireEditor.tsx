import React from 'react';
import { Button, Checkbox, Input, Select, Textarea } from '@/src/shared/ui';
import type { JsonObject, JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';

const QUESTION_TYPES = ['text', 'date', 'boolean', 'number', 'currency', 'textarea', 'select', 'multiselect', 'list'] as const;
const VISIBILITY_OPTIONS = ['all', 'customer', 'underwriter'] as const;

type QuestionOption = string | { value: string; label: string };
type Question = JsonObject & { key: string; label: string; type: string; options?: QuestionOption[]; visibility?: string; searchable?: boolean };
type Section = JsonObject & { id: string; title: string; questions: Question[] };

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asQuestion(value: JsonValue): Question | null {
  const record = asObject(value);
  if (!record || typeof record.key !== 'string' || typeof record.label !== 'string' || typeof record.type !== 'string') return null;
  if (record.options !== undefined && (!Array.isArray(record.options) || record.options.some((option) => typeof option !== 'string' && (!asObject(option) || typeof asObject(option)?.value !== 'string' || typeof asObject(option)?.label !== 'string')))) return null;
  if (record.visibility !== undefined && typeof record.visibility !== 'string') return null;
  if (record.searchable !== undefined && typeof record.searchable !== 'boolean') return null;
  return record as Question;
}

function asSection(value: JsonValue): Section | null {
  const record = asObject(value);
  if (!record || typeof record.id !== 'string' || typeof record.title !== 'string' || !Array.isArray(record.questions)) return null;
  const questions = record.questions.map(asQuestion);
  if (questions.some((question) => !question)) return null;
  const section: Section = {
    ...record,
    id: record.id,
    title: record.title,
    questions: questions as Question[],
  };
  return section;
}

function optionLines(options: QuestionOption[] = []): string {
  return options.map((option) => typeof option === 'string' ? option : `${option.value} | ${option.label}`).join('\n');
}

function parseOptions(value: string): QuestionOption[] {
  return value.split('\n').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const separator = entry.indexOf('|');
    if (separator === -1) return entry;
    const optionValue = entry.slice(0, separator).trim();
    const optionLabel = entry.slice(separator + 1).trim();
    return optionValue && optionLabel ? { value: optionValue, label: optionLabel } : entry;
  });
}

function QuestionEditor({ value, onChange, onRemove }: { value: Question; onChange: (next: Question) => void; onRemove: () => void }) {
  const supportsOptions = value.type === 'select' || value.type === 'multiselect';
  return <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex items-center justify-between gap-4"><p className="text-xs font-black text-slate-700">Question</p><Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove</Button></div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Answer key</p><Input value={value.key} onChange={(event) => onChange({ ...value, key: event.target.value })} aria-label="Question answer key" /><p className="text-xs font-medium text-slate-500">Stable path used to store and evaluate the answer.</p></div>
      <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Question text</p><Input value={value.label} onChange={(event) => onChange({ ...value, label: event.target.value })} aria-label="Question text" /><p className="text-xs font-medium text-slate-500">Customer-facing label shown in the configured journey.</p></div>
      <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Answer type</p><Select value={value.type} onChange={(event) => onChange({ ...value, type: event.target.value })} aria-label="Question answer type">{QUESTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</Select></div>
      <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Visible to</p><Select value={value.visibility || 'all'} onChange={(event) => onChange({ ...value, visibility: event.target.value })} aria-label="Question visibility">{VISIBILITY_OPTIONS.map((visibility) => <option key={visibility} value={visibility}>{visibility}</option>)}</Select></div>
    </div>
    {supportsOptions ? <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Answer options</p><Textarea rows={4} value={optionLines(value.options)} onChange={(event) => onChange({ ...value, options: parseOptions(event.target.value) })} aria-label="Question answer options" /><p className="text-xs font-medium text-slate-500">One option per line. Use <span className="font-mono">value | label</span> when the stored answer differs from its customer-facing label.</p><Checkbox checked={value.searchable === true} onChange={(event) => onChange({ ...value, searchable: event.target.checked })} label="Allow option search" /></div> : null}
  </div>;
}

function SectionEditor({ value, onChange, onRemove }: { value: Section; onChange: (next: Section) => void; onRemove: () => void }) {
  const updateQuestion = (index: number, question: Question) => onChange({ ...value, questions: value.questions.map((current, currentIndex) => currentIndex === index ? question : current) });
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between gap-4"><h3 className="text-xs font-black text-slate-800">Questionnaire section</h3><Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove section</Button></div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Section ID</p><Input value={value.id} onChange={(event) => onChange({ ...value, id: event.target.value })} aria-label="Questionnaire section ID" /></div><div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Section title</p><Input value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} aria-label="Questionnaire section title" /></div></div>
    <div className="space-y-3">{value.questions.map((question, index) => <QuestionEditor key={`${question.key}-${index}`} value={question} onChange={(next) => updateQuestion(index, next)} onRemove={() => onChange({ ...value, questions: value.questions.filter((_, currentIndex) => currentIndex !== index) })} />)}</div>
    <Button type="button" variant="secondary" size="sm" onClick={() => onChange({ ...value, questions: [...value.questions, { key: '', label: '', type: 'text', visibility: 'all' }] })}>Add question</Button>
  </section>;
}

/** Shared typed editor for question wording and rendered answer behaviour. */
export function ProgrammeQuestionnaireEditor({ value, onChange }: { value: JsonObject; onChange: (next: JsonObject) => void }) {
  const requiredness = asObject(value.requiredness);
  const sections = Array.isArray(value.sections) ? value.sections.map(asSection) : null;
  if (!requiredness || !sections || sections.some((section) => !section)) return <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">This draft requires a questionnaire requiredness map and fully structured sections before it can be edited or published. The system will not fill missing questions from a product manifest.</p>;
  const typedSections = sections as Section[];
  return <section className="space-y-5">
    <div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Questionnaire</h3><p className="mt-1 text-xs font-semibold text-slate-500">Edit the section titles, question text, answer types, choices and visibility that the published programme supplies to its journeys.</p></div>
    <div className="space-y-4">{typedSections.map((section, index) => <SectionEditor key={`${section.id}-${index}`} value={section} onChange={(next) => onChange({ ...value, sections: typedSections.map((current, currentIndex) => currentIndex === index ? next : current) })} onRemove={() => onChange({ ...value, sections: typedSections.filter((_, currentIndex) => currentIndex !== index) })} />)}</div>
    <Button type="button" variant="secondary" size="sm" onClick={() => onChange({ ...value, sections: [...typedSections, { id: '', title: '', questions: [] }] })}>Add section</Button>
  </section>;
}
