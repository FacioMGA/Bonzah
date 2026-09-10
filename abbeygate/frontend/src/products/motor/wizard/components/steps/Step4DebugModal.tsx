import type { MouseEvent as ReactMouseEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { WizardButton as Button } from '@/src/shared/ui';

type TraceStep = {
  name?: string;
  kind?: string;
  factor?: number;
  amount?: number;
  output?: number;
  notes?: string;
  inputs?: unknown;
};

type CalculationTrace = {
  steps?: TraceStep[];
};

type DebugOption = {
  annualPremium: number;
  calculationTrace?: CalculationTrace;
  costDetails?: unknown;
  breakdown?: unknown;
};

type Step4DebugModalProps = {
  isOpen: boolean;
  onClose: () => void;
  option: DebugOption;
  quoteReference: string;
};

export function Step4DebugModal(props: Step4DebugModalProps) {
  return (
    <AnimatePresence>
      {props.isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={props.onClose}
        >
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.95 }}
            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(event: ReactMouseEvent<HTMLDivElement>) => event.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Pricing Breakdown (Debug)</h3>
              <Button onClick={props.onClose} variant="secondary" className="text-gray-400 hover:text-gray-600">
                Close
              </Button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Details</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-gray-50 p-3 rounded">
                    <span className="block text-xs text-gray-400">Total</span>
                    <span className="text-lg font-mono font-bold">€{props.option.annualPremium}</span>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <span className="block text-xs text-gray-400">Reference</span>
                    <span className="text-sm font-mono">{props.quoteReference}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Calculation Trace</h4>
                {props.option.calculationTrace?.steps ? (
                  <div className="border rounded overflow-hidden">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-gray-50 text-gray-500 font-medium border-b">
                        <tr>
                          <th className="p-2">Step</th>
                          <th className="p-2">Type</th>
                          <th className="p-2 text-right">Factor / Amount</th>
                          <th className="p-2 text-right">Output</th>
                          <th className="p-2">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {props.option.calculationTrace.steps.map((step, idx) => (
                          <tr key={idx} className="hover:bg-blue-50/50">
                            <td className="p-2 font-medium text-gray-900 border-r border-gray-100 max-w-col200">
                              {step.name}
                              {step.inputs != null && (
                                <details className="mt-1">
                                  <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-blue-500">Inputs</summary>
                                  <pre className="text-[9px] bg-slate-50 p-1 rounded mt-1 overflow-x-auto">
                                    {JSON.stringify(step.inputs, null, 1).replace(/"|{|}/g, '')}
                                  </pre>
                                </details>
                              )}
                            </td>
                            <td className="p-2 text-gray-500 border-r border-gray-100">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${step.kind === 'subtotal' ? 'bg-indigo-100 text-indigo-700' :
                                step.kind === 'factor' ? 'bg-amber-100 text-amber-700' :
                                  step.kind === 'table_lookup' ? 'bg-blue-100 text-blue-700' :
                                    step.kind === 'fee' ? 'bg-red-100 text-red-700' :
                                      'bg-gray-100 text-gray-600'
                                }`}>
                                {step.kind}
                              </span>
                            </td>
                            <td className="p-2 text-right font-mono border-r border-gray-100">
                              {step.factor !== undefined ? (
                                <span className="text-amber-600 font-bold">x{step.factor.toFixed(4)}</span>
                              ) : step.amount !== undefined ? (
                                <span className="text-red-600">+€{step.amount.toFixed(2)}</span>
                              ) : '-'}
                            </td>
                            <td className="p-2 text-right font-mono font-medium text-gray-900 border-r border-gray-100">
                              {step.output !== undefined ? `€${step.output.toFixed(2)}` : '-'}
                            </td>
                            <td className="p-2 text-gray-400 italic max-w-col150">
                              {step.notes}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No detailed trace available.</p>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Cost Details (Step 5)</h4>
                <pre className="bg-slate-900 text-slate-50 p-4 rounded-lg text-xs font-mono overflow-x-auto">
                  {JSON.stringify(props.option.costDetails, null, 2)}
                </pre>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Raw Breakdown Object</h4>
                <pre className="bg-slate-900 text-slate-50 p-4 rounded-lg text-xs font-mono overflow-x-auto">
                  {JSON.stringify(props.option.breakdown, null, 2)}
                </pre>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
