/**
 * AccessControlPage — BO surface page wrapper.
 *
 * Thin page shell: just mounts the AccessControlView product.
 * All logic lives in the product layer.
 */
import React from 'react';
import { AccessControlView } from '@/src/modules/accessControl/views/AccessControlView';

type AccessControlPageProps = {
  activeTab?: 'users' | 'roles' | 'audit';
};

export default function AccessControlPage({ activeTab = 'users' }: AccessControlPageProps) {
  return <AccessControlView activeTab={activeTab} />;
}
