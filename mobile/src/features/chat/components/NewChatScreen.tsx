import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { ChevronLeft, Share2, Ellipsis, Paperclip, Send } from 'lucide-react-native';
import { ChatMessage, PendingQuestion } from '../types';
import AskQuestionCard from './AskQuestionCard';

interface Props {
  agentName: string;
  messages: ChatMessage[];
  pendingQuestion?: PendingQuestion | null;
  onBack: () => void;
  onSend: (text: string) => void;
  onAnswerQuestion?: (questionId: string, selectedOptionId: string) => void;
  onDismissQuestion?: () => void;
}

const SUGGESTION_CHIPS = ['Summarize', 'Explain more', 'Give examples'];

export default function NewChatScreen({
  agentName,
  messages,
  pendingQuestion,
  onBack,
  onSend,
  onAnswerQuestion,
  onDismissQuestion,
}: Props) {
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setIsTyping(true);
    onSend(text);
    setTimeout(() => setIsTyping(false), 2000);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Nav bar */}
      <View style={s.nav}>
        <TouchableOpacity onPress={onBack}>
          <ChevronLeft size={24} color="#20C20E" />
        </TouchableOpacity>
        <Text style={s.navTitle}>{agentName.toUpperCase()}</Text>
        <View style={s.navRight}>
          <Share2 size={20} color="#20C20E" />
          <Ellipsis size={20} color="#20C20E" />
        </View>
      </View>

      {/* Chat area */}
      <ScrollView
        ref={scrollRef}
        style={s.chatArea}
        contentContainerStyle={s.chatContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.map((msg) => (
          <View
            key={msg.id}
            style={msg.role === 'user' ? s.userWrap : s.aiWrap}
          >
            <View style={msg.role === 'user' ? s.userBubble : s.aiBubble}>
              <Text style={msg.role === 'user' ? s.userText : s.aiText}>
                {msg.content}
              </Text>
            </View>
          </View>
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <View style={s.aiWrap}>
            <View style={[s.aiBubble, s.typingBubble]}>
              <View style={s.dot} />
              <View style={s.dot} />
              <View style={s.dot} />
            </View>
          </View>
        )}

        {/* Pending question card */}
        {pendingQuestion && (
          <View style={s.aiWrap}>
            <AskQuestionCard
              question={pendingQuestion.question}
              subtitle={pendingQuestion.subtitle}
              options={pendingQuestion.options}
              onCancel={() => onDismissQuestion?.()}
              onConfirm={(selectedId) =>
                onAnswerQuestion?.(pendingQuestion.id, selectedId)
              }
            />
          </View>
        )}

        {/* Suggestion chips */}
        {!pendingQuestion && (
          <View style={s.chipsRow}>
            {SUGGESTION_CHIPS.map((chip) => (
              <TouchableOpacity
                key={chip}
                style={s.chip}
                onPress={() => onSend(chip)}
              >
                <Text style={s.chipText}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Input bar */}
      <View style={s.inputBar}>
        <Paperclip size={20} color="#2D8B2D" />
        <View style={s.inputField}>
          <TextInput
            style={s.input}
            placeholder={`Message ${agentName}...`}
            placeholderTextColor="#2D8B2D"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            multiline={false}
          />
        </View>
        <TouchableOpacity onPress={handleSend}>
          <Send size={20} color="#20C20E" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#040D04',
  },
  nav: {
    height: 52,
    backgroundColor: '#061206',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  navTitle: {
    fontFamily: 'Anton',
    fontSize: 16,
    color: '#20C20E',
  },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chatArea: {
    flex: 1,
    backgroundColor: '#040D04',
  },
  chatContent: {
    padding: 16,
    gap: 12,
  },
  aiWrap: {
    width: '100%',
    alignItems: 'flex-start',
  },
  userWrap: {
    width: '100%',
    alignItems: 'flex-end',
  },
  aiBubble: {
    maxWidth: 280,
    backgroundColor: '#061206',
    borderRadius: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#0F2B0F',
  },
  userBubble: {
    maxWidth: 240,
    backgroundColor: '#FFB000',
    borderRadius: 0,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 12,
  },
  aiText: {
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#20C20E',
    lineHeight: 20,
  },
  userText: {
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#040D04',
    lineHeight: 20,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 64,
    height: 36,
    paddingHorizontal: 14,
    paddingVertical: 0,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#20C20E',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    height: 32,
    borderRadius: 16,
    backgroundColor: '#061206',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#20C20E',
  },
  inputBar: {
    height: 60,
    backgroundColor: '#061206',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#0F2B0F',
  },
  inputField: {
    flex: 1,
    height: 36,
    backgroundColor: '#0A1A0A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  input: {
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#20C20E',
  },
});
