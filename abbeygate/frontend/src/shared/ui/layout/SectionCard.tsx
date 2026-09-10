import { ReactNode } from 'react';

interface SectionCardProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}

export function SectionCard({ title, icon, children }: SectionCardProps) {
  return (
    <div className="mb-8 space-y-6">
      {title && (
        <div className="flex items-center gap-3 mb-6 group w-fit cursor-default">
          {icon && (
            <div className="text-brand-primary transition-all duration-500 ease-out group-hover:text-blue-500 group-hover:scale-110 group-hover:drop-shadow-[0_0_6px_rgba(59,130,246,0.5)]">
              {icon}
            </div>
          )}
          <h3 className="text-xl font-black text-slate-900 tracking-tight transition-colors duration-300">
            {title}
          </h3>
        </div>
      )}
      {children}
    </div>
  );
}
