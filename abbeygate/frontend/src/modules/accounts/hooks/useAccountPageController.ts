import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { isPossiblePhoneNumber } from 'react-phone-number-input';
import { accountsApiClient } from '@/src/modules/accounts/api/accountsApiClient';
import type { Account, AccountFormState } from '@/src/modules/accounts/model/account';
import {
    EMPTY_ACCOUNT_FORM,
    toAccountFormState,
    buildAccountPayload,
} from '@/src/modules/accounts/model/account';
import { useRecordListController } from '@/src/shared/core/recordList/useRecordListController';
import { logger } from '@/src/shared/lib/logger';
import { accountsAdapter } from '@/src/modules/accounts/list/accountsAdapter';
import { createAccountsListConfig } from '@/src/modules/accounts/list/accountsListConfig';

type AccountEditorTab = 'identity' | 'financial';
type WorkspaceTab = 'overview' | 'policies' | 'claims' | 'billing' | 'documents' | 'communications' | 'contacts' | 'notes';
const WORKSPACE_TABS: WorkspaceTab[] = ['overview', 'policies', 'claims', 'billing', 'documents', 'communications', 'notes', 'contacts'];
const DEFAULT_WORKSPACE_TAB: WorkspaceTab = 'overview';

export function useAccountPageController() {
    const navigate = useNavigate();
    const location = useLocation();
    const { id: routeId } = useParams();
    const queryClient = useQueryClient();

    const [view, setView] = useState<'list' | 'workspace' | 'editor'>('list');
    const [isEditing, setIsEditing] = useState(false);
    const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<AccountEditorTab>('identity');
    const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(DEFAULT_WORKSPACE_TAB);
    const [workspaceLoading, setWorkspaceLoading] = useState(false);
    const [workspaceData, setWorkspaceData] = useState<Record<string, unknown>>({});

    const [form, setForm] = useState<AccountFormState>(EMPTY_ACCOUNT_FORM);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [accountToDelete, setAccountToDelete] = useState<{ id: string; name: string } | null>(null);

    const listConfig = useMemo(() => createAccountsListConfig(), []);
    const listController = useRecordListController({ adapter: accountsAdapter, config: listConfig, limit: 12 });

    useEffect(() => {
        const hash = String(location.hash || '').replace('#', '').toLowerCase();
        const nextTab = WORKSPACE_TABS.includes(hash as WorkspaceTab) ? (hash as WorkspaceTab) : DEFAULT_WORKSPACE_TAB;
        setWorkspaceTab(nextTab);
    }, [location.hash]);

    useEffect(() => {
        if (!routeId || routeId === 'new') return;
        const hash = String(location.hash || '').replace('#', '').toLowerCase();
        if (!hash || !WORKSPACE_TABS.includes(hash as WorkspaceTab)) {
            navigate(
                { pathname: `/accounts/${routeId}`, search: location.search, hash: `#${DEFAULT_WORKSPACE_TAB}` },
                { replace: true }
            );
        }
    }, [location.hash, location.search, navigate, routeId]);

    const loadWorkspace = useCallback(async (id: string) => {
        setWorkspaceLoading(true);
        try {
            const [intelligence, overview, policies, claims, billing, documents, communications, contacts, feed] = await Promise.all([
                accountsApiClient.getAccountIntelligence(id),
                accountsApiClient.getAccount360Overview(id),
                accountsApiClient.getAccount360Policies(id),
                accountsApiClient.getAccount360Claims(id),
                accountsApiClient.getAccount360Billing(id),
                accountsApiClient.getAccount360Documents(id),
                accountsApiClient.getAccount360Communications(id),
                accountsApiClient.getAccount360Contacts(id),
                accountsApiClient.getAccount360Feed(id, { limit: 50 }),
            ]);
            setWorkspaceData({
                intelligence: intelligence?.success ? intelligence.data : null,
                overview: overview?.success ? overview.data : null,
                policies: policies?.success ? policies.data : [],
                claims: claims?.success ? claims.data : { items: [], summary: null },
                billing: billing?.success ? billing.data : null,
                documents: documents?.success ? documents.data : [],
                communications: communications?.success ? communications.data : [],
                contacts: contacts?.success ? contacts.data : [],
                feed: feed?.success ? (feed.data as { items?: unknown[] })?.items || [] : [],
            });
        } catch (error) {
            logger.error('Failed to load account workspace', error);
            setWorkspaceData({});
        } finally {
            setWorkspaceLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!routeId) {
            setView('list');
            setEditingAccountId(null);
            setIsEditing(false);
            setWorkspaceData({});
            return;
        }
        if (routeId === 'new') {
            setEditingAccountId(null);
            setIsEditing(true);
            setView('editor');
            setActiveTab('identity');
            return;
        }
        setView('workspace');
        setEditingAccountId(routeId);
        void loadWorkspace(routeId);
    }, [routeId, loadWorkspace]);

    const isValidName = (name: string) => /^[a-zA-Z\s\-']+$/.test(name);

    const handleSaveAccount = useCallback(async () => {
        const newErrors: Record<string, string> = {};
        if (!form.name) {
            newErrors.name = 'Company Name is required.';
        } else if (!isValidName(form.name)) {
            newErrors.name = 'Name can only contain letters, spaces, hyphens and apostrophes.';
        }
        if (!form.firstName) {
            newErrors.firstName = 'First name is required.';
        }
        if (!form.lastName) {
            newErrors.lastName = 'Last name is required.';
        }
        if (!form.email) {
            newErrors.email = 'Email is required.';
        }
        if (!form.phone) {
            newErrors.phone = 'Phone number is required.';
        } else if (!isPossiblePhoneNumber(form.phone)) {
            newErrors.phone = 'Invalid phone number format.';
        }

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        try {
            const payload = buildAccountPayload(form);

            if (editingAccountId) {
                const res = await accountsApiClient.updateAccount(editingAccountId, payload);
                if (res.success) {
                    queryClient.invalidateQueries({ queryKey: ['accounts', 'recordList'] });
                    setIsEditing(false);
                    setWorkspaceTab('contacts');
                    setView('workspace');
                    void loadWorkspace(editingAccountId);
                    navigate(
                        { pathname: `/accounts/${editingAccountId}`, search: location.search, hash: '#contacts' },
                        { replace: true, preventScrollReset: true }
                    );
                }
            } else {
                const res = await accountsApiClient.createAccount(payload);
                if (res.success) {
                    queryClient.invalidateQueries({ queryKey: ['accounts', 'recordList'] });
                    navigate('/accounts');
                }
            }
        } catch (error) {
            logger.error('Save account failed', error);
        }
    }, [form, editingAccountId, queryClient, navigate, loadWorkspace, location.search]);

    const handleEditAccount = useCallback((account: Account) => {
        setForm(toAccountFormState(account));
        setEditingAccountId(account.id);
        setIsEditing(false);
        setView('editor');
        setActiveTab('identity');
        setErrors({});
    }, []);

    const handleDeleteAccount = useCallback((id: string, name: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setAccountToDelete({ id, name });
        setDeleteModalOpen(true);
    }, []);

    const confirmDeleteAccount = useCallback(async () => {
        if (!accountToDelete) return;
        try {
            const res = await accountsApiClient.deleteAccount(accountToDelete.id);
            if (res.success) {
                queryClient.invalidateQueries({ queryKey: ['accounts', 'recordList'] });
            } else {
                logger.error('Delete failed');
            }
        } catch (error) {
            logger.error('Delete error', error);
        } finally {
            setDeleteModalOpen(false);
            setAccountToDelete(null);
        }
    }, [accountToDelete, queryClient]);

    const closeDeleteModal = useCallback(() => {
        setDeleteModalOpen(false);
    }, []);

    const navigateToList = useCallback(() => {
        setView('list');
        setEditingAccountId(null);
        setIsEditing(false);
        setWorkspaceData({});
        navigate('/accounts');
    }, [navigate]);

    const navigateToNew = useCallback(() => {
        navigate('/accounts/new');
    }, [navigate]);

    const navigateToWorkspaceTab = useCallback((tab: WorkspaceTab) => {
        if (!routeId || routeId === 'new') return;
        const safeTab = WORKSPACE_TABS.includes(tab) ? tab : DEFAULT_WORKSPACE_TAB;
        navigate({ pathname: `/accounts/${routeId}`, search: location.search, hash: `#${safeTab}` }, { replace: true, preventScrollReset: true });
    }, [location.search, navigate, routeId]);

    const openPrimaryContactEditor = useCallback(async () => {
        const id = String(editingAccountId || '').trim();
        if (!id) return;
        try {
            const res = await accountsApiClient.getAccount(id);
            if (res?.success && res.data) {
                setForm(toAccountFormState(res.data as Account));
            }
            setErrors({});
            setActiveTab('identity');
            setIsEditing(true);
            setView('editor');
        } catch (error) {
            logger.error('Failed to open contact editor', error);
        }
    }, [editingAccountId]);

    return {
        view,
        isEditing,
        editingAccountId,
        activeTab,
        form,
        setForm,
        errors,
        setErrors,
        deleteModalOpen,
        accountToDelete,
        listController,
        workspaceTab,
        workspaceLoading,
        workspaceData,
        setActiveTab,
        setIsEditing,
        handleSaveAccount,
        handleEditAccount,
        handleDeleteAccount,
        confirmDeleteAccount,
        closeDeleteModal,
        navigateToList,
        navigateToNew,
        navigateToWorkspaceTab,
        openPrimaryContactEditor,
    };
}
