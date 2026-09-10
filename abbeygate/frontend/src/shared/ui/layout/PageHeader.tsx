import React from 'react';
import { StatusPill, StatusTone } from '@/src/shared/ui/feedback/StatusPill';
import { IconButton } from '@/src/shared/ui/icons/IconButton';

export type BreadcrumbItem = {
  label: string;
  onClick?: () => void;
};

export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  meta,
  status,
  actions,
}: {
  breadcrumb?: BreadcrumbItem;
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  status?: { label: string; tone?: StatusTone };
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
      <div className="min-w-0">
        <div className="flex items-start gap-4">
          {breadcrumb && (
            <IconButton
              onClick={breadcrumb.onClick}
              title={breadcrumb.label}
              variant="neutral"
              className="shrink-0 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </IconButton>
          )}

          <div className="min-w-0">
            <div className="flex items-center flex-wrap gap-3">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight truncate">
                {title}
              </h1>
              {status && <StatusPill label={status.label} tone={status.tone} />}
            </div>
            {(subtitle || meta) && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
                {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
                {meta}
              </div>
            )}
          </div>
        </div>
      </div>

      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
