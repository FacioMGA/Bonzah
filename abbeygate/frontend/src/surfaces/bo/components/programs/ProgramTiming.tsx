import React, { useState, useEffect } from 'react';
import { Select } from '@/src/shared/ui';
import type { Program, Cadence } from '@/src/modules/programs/model/programs';

interface ProgramTimingProps {
    program: Program;
    isEditing: boolean;
    onUpdate: (updates: Partial<Program>) => void;
}

export const ProgramTiming: React.FC<ProgramTimingProps> = ({ program, isEditing, onUpdate }) => {
    const [cadence, setCadence] = useState<Cadence>(program.cadence);

    useEffect(() => {
        if (!isEditing) setCadence(program.cadence);
    }, [program, isEditing]);

    const handleCadenceChange = (val: Cadence) => {
        setCadence(val);
        onUpdate({ cadence: val });
    };

    return (
        <div className="ui-card ui-card-pad space-y-6">
            <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Policy timing</div>
                <h2 className="text-xl font-black text-slate-900 mt-1">Cadence, proration, cancellation</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Cadence</label>
                    {isEditing ? (
                        <Select
                            className="ui-select"
                            value={cadence}
                            onChange={(e) => handleCadenceChange(e.target.value as Cadence)}
                        >
                            <option>Monthly</option>
                            <option>Annual (paid upfront)</option>
                        </Select>
                    ) : (
                        <div className="text-sm font-black text-slate-900">{program.cadence}</div>
                    )}
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-2">
                    <div className="text-sm font-black text-slate-900">Proration rules</div>
                    <div className="text-sm text-slate-600 font-medium leading-relaxed">
                        Mid-term starts/changes are prorated to month boundaries and captured as endorsements with immutable history.
                    </div>
                </div>
            </div>
        </div>
    );
};
