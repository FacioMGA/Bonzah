export const licenseYearsOptions = [
  { value: '', label: 'Please Select' },
  ...Array.from({ length: 61 }, (_, i) => ({
    value: String(i),
    label: i === 0 ? 'Less than 1 year' : `${i} ${i === 1 ? 'year' : 'years'}`,
  })),
];

