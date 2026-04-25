import React from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { Button } from '@/components/ui/Button';

interface Props {
  visible: boolean;
  result: string | null;
  error: string | null;
  onClose: () => void;
}

export function InvokeModal({ visible, result, error, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-end">
        <Animated.View
          entering={SlideInDown.springify()}
          className="bg-white dark:bg-slate-800 rounded-t-3xl p-6 max-h-[70%]"
        >
          <Text className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">
            Invoke Response
          </Text>
          <ScrollView className="max-h-72 mb-4">
            {error ? (
              <Text className="text-sm text-danger">{error}</Text>
            ) : (
              <Text className="text-sm text-slate-700 dark:text-slate-300 font-mono">{result}</Text>
            )}
          </ScrollView>
          <Button label="Close" onPress={onClose} variant="secondary" />
        </Animated.View>
      </View>
    </Modal>
  );
}
