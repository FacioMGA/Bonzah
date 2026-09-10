import React, { useState } from 'react';
import { McpKeysView } from '@/src/modules/configuration/views/McpKeysView';
import { OAuthClientsView } from '@/src/modules/configuration/views/OAuthClientsView';
import { OperatorActionHistoryView } from '@/src/modules/configuration/views/OperatorActionHistoryView';
import { ProductArchitectView } from '@/src/modules/configuration/views/ProductArchitectView';

type Tab = 'architect' | 'remote-keys' | 'oauth-clients' | 'operator-actions';

/**
 * BO Product Architect page (ADR-0036 + amendment). Mounts the BO
 * Architect demo view AND the remote MCP key management view.
 *
 * The page itself is a thin shell — the surfaces contract forbids
 * business logic in surfaces (`frontend/src/surfaces/bo/`).
 */
const ProductArchitectPage: React.FC = () => {
    const [tab, setTab] = useState<Tab>('architect');
    return (
        <div className="p-6 space-y-6">
            <header>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">Product Architect</h1>
                <p className="text-sm text-slate-500 mt-1 max-w-2xl">
                    Configure a new product variant in natural language. Every change is staged on a
                    Config MCP draft and only writes canonical Program / Binder / Tenant rows when you
                    publish to a sandbox tenant. Issue API keys to let customers drive the same surface
                    from Claude or ChatGPT.
                </p>
            </header>
            <nav className="flex gap-2 border-b border-slate-200">
                <TabButton active={tab === 'architect'} onClick={() => setTab('architect')}>
                    BO architect
                </TabButton>
                <TabButton active={tab === 'remote-keys'} onClick={() => setTab('remote-keys')}>
                    Remote MCP keys
                </TabButton>
                <TabButton active={tab === 'oauth-clients'} onClick={() => setTab('oauth-clients')}>
                    OAuth clients
                </TabButton>
                <TabButton active={tab === 'operator-actions'} onClick={() => setTab('operator-actions')}>
                    Operator action history
                </TabButton>
            </nav>
            {tab === 'architect' && <ProductArchitectView />}
            {tab === 'remote-keys' && <McpKeysView />}
            {tab === 'oauth-clients' && <OAuthClientsView />}
            {tab === 'operator-actions' && <OperatorActionHistoryView />}
        </div>
    );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
    active,
    onClick,
    children,
}) => (
    <button
        onClick={onClick}
        className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 ${
            active ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
        }`}
    >
        {children}
    </button>
);

export default ProductArchitectPage;
