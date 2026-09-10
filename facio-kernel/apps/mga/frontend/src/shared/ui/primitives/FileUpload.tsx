import React, { InputHTMLAttributes } from 'react';
import { Button } from './Button';

export interface FileUploadProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    /** Text displayed on the button. */
    label?: string;
    /** If provided, renders an uploaded file name next to the button. */
    fileName?: string;
    /** Triggers when one or multiple files are selected. */
    onFileSelect?: (files: File[]) => void;
    /** Variant of the underlying Button. */
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
    /** Size of the underlying Button. */
    buttonSize?: 'sm' | 'md' | 'lg';
}

export function FileUpload({
    label = 'Choose File',
    fileName,
    onFileSelect,
    variant = 'outline',
    buttonSize = 'sm',
    className = '',
    onChange,
    multiple,
    accept,
    ...props
}: FileUploadProps) {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (onChange) onChange(e);
        if (onFileSelect && e.target.files) {
            onFileSelect(Array.from(e.target.files));
        }
    };

    return (
        <div className={`flex items-center gap-3 ${className}`}>
            <label className="cursor-pointer relative z-0 flex-shrink-0">
                <Button asChild variant={variant} size={buttonSize} className="pointer-events-none">
                    <span>{label}</span>
                </Button>
                <input
                    type="file"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={handleChange}
                    multiple={multiple}
                    accept={accept}
                    {...props}
                />
            </label>
            {fileName && (
                <span className="text-sm text-slate-500 font-medium truncate max-w-col200">
                    {fileName}
                </span>
            )}
        </div>
    );
}
