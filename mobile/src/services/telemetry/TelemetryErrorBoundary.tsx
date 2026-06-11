import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { TelemetryService } from './TelemetryService';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class TelemetryErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      TelemetryService.getInstance().track({
        event_type: 'js_crash',
        level: 'error',
        data: {
          error_message: error.message,
          stack_trace: error.stack ?? '',
          component_stack: info.componentStack ?? '',
          screen: 'unknown',
        },
      });
    } catch {
      // Never let telemetry crash the error boundary itself
    }
    console.error('[TelemetryErrorBoundary]', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-xl font-bold text-danger mb-2">Something went wrong</Text>
          <Text className="text-sm text-slate-500 text-center mb-5">
            {this.state.error?.message}
          </Text>
          <Pressable className="bg-primary px-6 py-2.5 rounded-lg" onPress={this.handleReset}>
            <Text className="text-white font-semibold">Try Again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}
