import React from 'react';
import { View, type ViewProps } from 'react-native';

interface CardProps extends ViewProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <View
      className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 ${className}`}
      {...props}
    >
      {children}
    </View>
  );
}
