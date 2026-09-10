import React from 'react';

export type CustomerFollowUpRequest = {
  id: string;
  fieldKey: string;
  question: string;
  note: string;
  type: string;
  stepKey?: 'policy-holder' | 'driving-history' | 'vehicle-cover' | 'your-quote' | 'payment' | '';
  requestedAt?: string;
};

export type FollowUpContextValue = {
  followUpMode: boolean;
  followUpRequests: CustomerFollowUpRequest[];
};

const FollowUpContext = React.createContext<FollowUpContextValue>({
  followUpMode: false,
  followUpRequests: [],
});

export function FollowUpProvider(props: { value: FollowUpContextValue; children: React.ReactNode }) {
  return <FollowUpContext.Provider value={props.value}>{props.children}</FollowUpContext.Provider>;
}

export function useFollowUps() {
  return React.useContext(FollowUpContext);
}
