import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FileText,
  ListChecks,
  Pencil,
  Terminal,
  WandSparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { type ToolCallPayload, type ToolResultPayload } from '@/types';

interface Props {
  call: ToolCallPayload;
  result?: ToolResultPayload;
}

type ToolKind = 'bash' | 'read' | 'edit' | 'todo' | 'skill' | 'subagent' | 'mcp' | 'tool';

interface ToolMeta {
  title: string;
  Icon: LucideIcon;
  surface: string;
  border: string;
  iconBg: string;
  iconColor: string;
  accent: string;
}

interface TodoItem {
  content: string;
  status: string;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function readString(obj: Record<string, unknown> | null, keys: string[]): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function readTodoItems(parsed: Record<string, unknown> | null): TodoItem[] {
  if (!Array.isArray(parsed?.todos)) return [];
  return parsed.todos.map((rawTodo, index) => {
    if (!rawTodo || typeof rawTodo !== 'object' || Array.isArray(rawTodo)) {
      return { content: `Task ${index + 1}`, status: 'pending' };
    }
    const todo = rawTodo as Record<string, unknown>;
    const content =
      readString(todo, ['content', 'text', 'title', 'task', 'summary']) ?? `Task ${index + 1}`;
    const status = typeof todo.status === 'string' ? todo.status : 'pending';
    return { content, status };
  });
}

function isTodoCompleted(todo: TodoItem) {
  return todo.status === 'completed';
}

function isTodoCurrent(todo: TodoItem) {
  return todo.status === 'in_progress';
}

function clip(text: string, max: number) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max).trimEnd()}...`;
}

function prettyArgs(raw: string, parsed: Record<string, unknown> | null) {
  if (!parsed) return clip(raw, 1800);
  return clip(JSON.stringify(parsed, null, 2), 1800);
}

function getToolKind(tool: string): ToolKind {
  const key = tool.toLowerCase();
  if (key.startsWith('mcp__') || key.includes('mcp')) return 'mcp';
  if (key.includes('todo')) return 'todo';
  if (key.includes('skill')) return 'skill';
  if (key === 'task' || key.includes('subagent')) return 'subagent';
  if (key.includes('edit') || key.includes('write') || key.includes('patch')) return 'edit';
  if (key.includes('read') || key.includes('file')) return 'read';
  if (key.includes('bash') || key.includes('shell') || key.includes('exec')) return 'bash';
  return 'tool';
}

function getToolMeta(tool: string): ToolMeta {
  const kind = getToolKind(tool);
  switch (kind) {
    case 'bash':
      return {
        title: 'Bash',
        Icon: Terminal,
        surface: brandRgba.white88,
        border: brandColors.silver,
        iconBg: brandColors.ink,
        iconColor: brandColors.white,
        accent: brandColors.cyan,
      };
    case 'read':
      return {
        title: 'Read File',
        Icon: FileText,
        surface: brandRgba.cyanSoft,
        border: brandColors.cyan,
        iconBg: brandColors.cyan,
        iconColor: brandColors.ink,
        accent: brandColors.cyan,
      };
    case 'edit':
      return {
        title: 'Edit File',
        Icon: Pencil,
        surface: brandRgba.coralSoft,
        border: brandColors.coral,
        iconBg: brandColors.coral,
        iconColor: brandColors.white,
        accent: brandColors.coral,
      };
    case 'todo':
      return {
        title: 'Todo List',
        Icon: ListChecks,
        surface: brandRgba.limeSoft,
        border: brandColors.lime,
        iconBg: brandColors.lime,
        iconColor: brandColors.ink,
        accent: brandColors.lime,
      };
    case 'skill':
      return {
        title: 'Skills',
        Icon: WandSparkles,
        surface: brandRgba.limeSoft,
        border: brandColors.lime,
        iconBg: brandColors.lime,
        iconColor: brandColors.ink,
        accent: brandColors.lime,
      };
    case 'subagent':
      return {
        title: 'Subagent',
        Icon: Bot,
        surface: brandRgba.sageSoft,
        border: brandColors.sage,
        iconBg: brandColors.sage,
        iconColor: brandColors.ink,
        accent: brandColors.sage,
      };
    case 'mcp':
      return {
        title: 'MCP',
        Icon: Workflow,
        surface: brandRgba.coralSoft,
        border: brandColors.coral,
        iconBg: brandColors.coral,
        iconColor: brandColors.white,
        accent: brandColors.coral,
      };
    default:
      return {
        title: tool || 'Tool',
        Icon: Workflow,
        surface: brandRgba.white88,
        border: brandColors.silver,
        iconBg: brandColors.silver,
        iconColor: brandColors.ink,
        accent: brandColors.cyan,
      };
  }
}

function formatMcpTool(tool: string) {
  const parts = tool.split('__').filter(Boolean);
  if (parts.length >= 3) return `${parts[1]}.${parts.slice(2).join('.')}`;
  return tool;
}

function getPrimaryDetail(call: ToolCallPayload, parsed: Record<string, unknown> | null) {
  const kind = getToolKind(call.tool);
  if (kind === 'mcp') return formatMcpTool(call.tool);
  if (kind === 'todo' && Array.isArray(parsed?.todos)) {
    const todos = readTodoItems(parsed);
    const done = todos.filter(isTodoCompleted).length;
    return `${done}/${todos.length} tasks`;
  }
  return (
    readString(parsed, ['command', 'cmd', 'file_path', 'path', 'source', 'description', 'name']) ??
    clip(call.args, 160)
  );
}

export function ToolCallRow({ call, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const parsedArgs = parseJsonObject(call.args);
  const meta = getToolMeta(call.tool);
  const Icon = meta.Icon;
  const statusLabel = result ? (result.ok ? 'Done' : 'Failed') : 'Running';
  const statusTone = result
    ? result.ok
      ? brandColors.successCompat
      : brandColors.error
    : meta.accent;
  const StatusIcon = result?.ok ? CircleCheck : result ? CircleAlert : null;
  const todoItems = getToolKind(call.tool) === 'todo' ? readTodoItems(parsedArgs) : [];
  const shouldRenderTodos = todoItems.length > 0;
  const todoDoneCount = todoItems.filter(isTodoCompleted).length;
  const detail = getPrimaryDetail(call, parsedArgs);
  const summary = result?.summary ? clip(result.summary, expanded ? 1800 : 180) : '';

  return (
    <TouchableOpacity
      testID="tool-call-row"
      accessibilityRole="button"
      activeOpacity={0.78}
      onPress={() => setExpanded((v) => !v)}
      style={[
        s.card,
        expanded || shouldRenderTodos ? s.cardExpanded : s.cardCollapsed,
        { backgroundColor: meta.surface, borderColor: meta.border },
      ]}
    >
      <View style={[s.accentRail, { backgroundColor: meta.accent }]} />
      <View style={s.mainRow}>
        <View style={[s.iconTile, { backgroundColor: meta.iconBg }]}>
          <Icon size={14} color={meta.iconColor} strokeWidth={2.2} />
        </View>
        <Text style={s.title} numberOfLines={1}>
          {meta.title}
        </Text>
        <Text style={s.detail} numberOfLines={1}>
          {detail}
        </Text>
        {shouldRenderTodos ? (
          <Text testID="tool-call-todo-progress" style={[s.todoProgress, { color: meta.accent }]}>
            {todoDoneCount}/{todoItems.length}
          </Text>
        ) : (
          <View style={[s.statusPill, { borderColor: statusTone }]}>
            {StatusIcon ? <StatusIcon size={10} color={statusTone} strokeWidth={2.2} /> : null}
            {!StatusIcon ? (
              <View
                testID="tool-call-status-dot"
                style={[s.statusDot, { backgroundColor: statusTone }]}
              />
            ) : null}
            <Text testID="tool-call-status-label" style={[s.statusText, { color: statusTone }]}>
              {statusLabel}
            </Text>
          </View>
        )}
        {expanded ? (
          <ChevronDown size={14} color={brandColors.textSoft} />
        ) : (
          <ChevronRight size={14} color={brandColors.textSoft} />
        )}
      </View>
      {shouldRenderTodos ? (
        <View testID="tool-call-todo-list" style={s.todoList}>
          {todoItems.map((todo, index) => {
            const completed = isTodoCompleted(todo);
            const current = isTodoCurrent(todo);
            return (
              <View key={`${todo.status}-${todo.content}-${index}`} style={s.todoItem}>
                <View
                  testID={`tool-call-todo-marker-${index}`}
                  style={[
                    s.todoMarker,
                    completed && s.todoMarkerDone,
                    current && s.todoMarkerCurrent,
                  ]}
                >
                  {completed ? (
                    <CircleCheck size={10} color={brandColors.white} strokeWidth={2.5} />
                  ) : null}
                </View>
                <Text
                  style={[s.todoText, completed && s.todoTextDone, current && s.todoTextCurrent]}
                  numberOfLines={1}
                >
                  {todo.content}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {expanded ? (
        <View style={s.expanded}>
          <Text style={s.sectionLabel}>Args</Text>
          <Text selectable style={s.codeText}>
            {prettyArgs(call.args, parsedArgs)}
          </Text>
          {summary ? (
            <>
              <Text style={s.sectionLabel}>Result</Text>
              <Text selectable style={s.codeText}>
                {summary}
              </Text>
            </>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardCollapsed: {
    height: 30,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  cardExpanded: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  accentRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconTile: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    maxWidth: 76,
    fontFamily: brandTypography.body,
    fontSize: 12,
    fontWeight: '800',
    color: brandColors.ink,
  },
  detail: {
    flex: 1,
    minWidth: 0,
    fontFamily: brandTypography.body,
    fontSize: 12,
    color: brandColors.ink,
  },
  statusPill: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: brandRgba.white70,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: {
    fontFamily: brandTypography.body,
    fontSize: 11,
    fontWeight: '700',
  },
  todoProgress: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    fontWeight: '800',
  },
  todoList: {
    marginTop: 6,
    gap: 5,
    paddingLeft: 28,
    paddingRight: 2,
  },
  todoItem: {
    minHeight: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  todoMarker: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: brandColors.textMuted,
    backgroundColor: brandRgba.white70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todoMarkerDone: {
    borderColor: brandColors.successCompat,
    backgroundColor: brandColors.successCompat,
  },
  todoMarkerCurrent: {
    borderColor: brandColors.coral,
    backgroundColor: brandRgba.white70,
  },
  todoText: {
    flex: 1,
    minWidth: 0,
    fontFamily: brandTypography.body,
    fontSize: 12,
    color: brandColors.textSoft,
  },
  todoTextDone: {
    color: brandColors.ink,
  },
  todoTextCurrent: {
    color: brandColors.ink,
    fontWeight: '700',
  },
  expanded: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: brandRgba.ink12,
    gap: 6,
  },
  sectionLabel: {
    fontFamily: brandTypography.body,
    fontSize: 11,
    fontWeight: '700',
    color: brandColors.textSoft,
  },
  codeText: {
    fontFamily: brandTypography.mono,
    fontSize: 11,
    lineHeight: 16,
    color: brandColors.ink,
    backgroundColor: brandRgba.white70,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
