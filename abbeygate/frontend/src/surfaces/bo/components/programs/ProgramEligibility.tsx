import React, { useState, useEffect } from 'react';
import { Select } from '@/src/shared/ui';
import type { Program } from '@/src/modules/programs/model/programs';

interface ProgramEligibilityProps {
    program: Program;
    isEditing: boolean;
    onUpdate: (updates: Partial<Program>) => void;
}

export const ProgramEligibility: React.FC<ProgramEligibilityProps> = ({ program, isEditing, onUpdate }) => {
    const [exceptionQueue, setExceptionQueue] = useState(program.validation.exceptionQueue);

    useEffect(() => {
        if (!isEditing) setExceptionQueue(program.validation.exceptionQueue);
    }, [program, isEditing]);

    const handleQueueChange = (val: Program['validation']['exceptionQueue']) => {
        setExceptionQueue(val);
        onUpdate({
            validation: {
                ...program.validation,
                exceptionQueue: val
            }
        });
    };

    return (
        <div className="ui-card ui-card-pad">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Eligibility</div>
            <div className="text-xl font-black text-slate-900 mt-2">Inputs, validations, and constraints</div>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                    <div className="text-sm font-black text-slate-800">Core rules</div>
                    <div className="mt-4 space-y-3 text-sm text-slate-700 font-medium">
                        <div className="text-sm text-slate-600 font-medium">
                            Motor product inputs are validated via MagicB (step-based) and program authority constraints.
                        </div>
                    </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                    <div className="text-sm font-black text-slate-800">Exception queue</div>
                    <div className="mt-4">
                        {isEditing ? (
                            <Select
                                className="ui-select"
                                value={exceptionQueue}
                                onChange={(e) => handleQueueChange(e.target.value as Program['validation']['exceptionQueue'])}
                            >
                                <option>Auto-create exceptions</option>
                                <option>Block until fixed</option>
                            </Select>
                        ) : (
                            <div className="text-sm font-black text-slate-900 mt-1">{program.validation.exceptionQueue}</div>
                        )}
                        <div className="text-sm text-slate-600 font-medium mt-3">
                            Route anomalies to an exception queue with full audit trail.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
