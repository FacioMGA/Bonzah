/**
 * Users API Client — Domain-Scoped (CHAMPS)
 *
 * Canonical import for user management API calls.
 * Owns: list, invite, update, status, delete, password reset, current user.
 *
 * Calls http.request() directly.
 */
import { http } from '@/src/shared/api/http';

type UnknownRecord = Record<string, unknown>;

export const usersApiClient = {
    async listUsers() {
        return http.request<UnknownRecord[]>('users');
    },

    async inviteUser(data: { email: string; name?: string; role: string; team?: string }) {
        return http.request('users', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateUser(id: string, data: { name?: string; email?: string; phone?: string; role?: 'ADMIN' | 'UNDERWRITER' | 'CUSTOMER'; team?: string }) {
        return http.request(`users/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async updateUserStatus(id: string, isActive: boolean) {
        return http.request(`users/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive }),
        });
    },

    async adminResetPassword(id: string) {
        return http.request(`users/${id}/reset-password`, {
            method: 'POST',
        });
    },

    async deleteUser(userId: string) {
        return http.request(`users/${userId}`, {
            method: 'DELETE',
        });
    },

    async getCurrentUser() {
        return http.request<UnknownRecord>('users/me');
    },
};

export type UsersApiClient = typeof usersApiClient;
