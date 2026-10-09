export const useNumber = (value: number): string => Intl.NumberFormat('en').format(value);
