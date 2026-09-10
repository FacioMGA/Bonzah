import React from 'react';
import { ClaimsListView } from '@/src/modules/claims/desk/views/ClaimsListView';

type Props = {
  onCreateNewCase: () => void;
};

export function ClaimsDeskList({ onCreateNewCase }: Props) {
  return <ClaimsListView onCreateNewCase={onCreateNewCase} />;
}

