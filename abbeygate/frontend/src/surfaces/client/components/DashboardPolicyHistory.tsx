/**
 * DashboardPolicyHistory — "Past Policies" table tab.
 * Consumes only DashboardPolicyVM[].
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/src/shared/ui';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/shared/ui';
import { ChevronRight } from 'lucide-react';
import { formatDateUI } from '@/src/shared/lib/format';
import type { DashboardPolicyVM } from '../types/dashboard.contract';

interface Props {
    policies: DashboardPolicyVM[];
}

export function DashboardPolicyHistory({ policies }: Props) {
    const navigate = useNavigate();

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="text-lg font-black text-slate-900">Policy History</h2>
                <p className="text-sm font-semibold text-slate-500">Read-only archive of expired or cancelled cover.</p>
            </div>
            {policies.length === 0 ? (
                <div className="px-5 py-6 text-sm font-semibold text-slate-500">No past policies yet.</div>
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Asset</TableHead>
                                <TableHead>Policy Number</TableHead>
                                <TableHead>End Date</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {policies.map((policy) => (
                                <TableRow key={policy.key}>
                                    <TableCell>{policy.vehicleTitle}</TableCell>
                                    <TableCell>{policy.policyNumber}</TableCell>
                                    <TableCell>{formatDateUI(policy.endDate)}</TableCell>
                                    <TableCell>{policy.statusMeta.title}</TableCell>
                                    <TableCell>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => navigate(`/client/policies/${encodeURIComponent(policy.key)}`)}
                                            className="font-black text-slate-700 hover:text-slate-900 inline-flex items-center gap-1 bg-transparent !p-0"
                                        >
                                            View details <ChevronRight className="w-4 h-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
