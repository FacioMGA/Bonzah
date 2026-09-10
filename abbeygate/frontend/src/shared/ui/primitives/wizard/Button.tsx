import { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button as UiButton } from '@/src/shared/ui/primitives/Button';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'link';
  icon?: ReactNode;
}

export function Button({ variant = 'primary', icon, children, className = '', ...props }: ButtonProps) {
  const baseClassName = variant === 'link'
    ? 'h-auto min-h-0 p-0 rounded-none text-[15px] font-semibold tracking-tight inline-flex items-center justify-start gap-2'
    : 'rounded-full px-7 py-3 text-[15px] font-semibold tracking-tight flex items-center justify-center gap-2';

  return (
    <UiButton
      {...props}
      variant={variant}
      className={`${baseClassName} ${className}`}
    >
      {icon}
      {children}
    </UiButton>
  );
}
