import React, { useState } from 'react';
import { Text, TextInput, type TextInputProps, View } from 'react-native';

interface InputProps extends TextInputProps {
  label?: string;
  className?: string;
}

export function Input({ label, className = '', ...props }: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View className="mb-5">
      {label ? (
        <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
          {label}
        </Text>
      ) : null}
      <TextInput
        className={`border rounded-xl px-3 py-3 text-base bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 ${
          focused
            ? 'border-primary dark:border-primary-dark'
            : 'border-slate-200 dark:border-slate-700'
        } ${className}`}
        placeholderTextColor="#2D8B2D"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...props}
      />
    </View>
  );
}
