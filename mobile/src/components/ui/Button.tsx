import React from 'react';
import { Pressable, Text } from 'react-native';

type Variant = 'primary' | 'secondary' | 'destructive';

const VARIANT_CLASSES: Record<Variant, { container: string; text: string }> = {
  primary:     { container: 'bg-primary dark:bg-primary-dark',                              text: 'text-white' },
  secondary:   { container: 'bg-transparent border border-slate-300 dark:border-slate-600', text: 'text-slate-800 dark:text-slate-100' },
  destructive: { container: 'bg-danger',                                                    text: 'text-white' },
};

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  loadingLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const { container, text } = VARIANT_CLASSES[variant];

  return (
    <Pressable
      onPress={() => { if (!isDisabled) onPress(); }}
      className={`rounded-xl py-4 items-center ${container} ${isDisabled ? 'opacity-50' : ''}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
    >
      <Text className={`text-base font-semibold ${text}`}>
        {loading && loadingLabel ? loadingLabel : label}
      </Text>
    </Pressable>
  );
}
