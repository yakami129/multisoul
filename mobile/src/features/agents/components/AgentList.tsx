import { AlertCircle, Plus, Search } from 'lucide-react-native';
import React from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChatStore } from '@/store/chatStore';
import { type Agent, type Conversation } from '@/types';
import { AgentCard } from './AgentCard';

interface Props {
  agents: Agent[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  onRefetch: () => void;
  onAgentPress: (id: string, endpoint_id: string, name: string) => void;
}

type ProjectStatus = {
  label: string;
  isActive: boolean;
  pendingCount: number;
};

type ProjectItem = {
  agent: Agent;
  status: ProjectStatus;
};

function projectStatus(conversations: Conversation[]): ProjectStatus {
  const pendingCount = conversations.filter((conv) => conv.status === 'awaiting_question').length;
  if (pendingCount > 0) {
    return { label: 'Running · Awaiting answer', isActive: true, pendingCount };
  }
  if (conversations.some((conv) => conv.status === 'running')) {
    return { label: 'Running', isActive: true, pendingCount: 0 };
  }
  if (conversations.some((conv) => conv.status === 'failed')) {
    return { label: 'Failed', isActive: false, pendingCount: 0 };
  }
  return { label: 'Idle', isActive: false, pendingCount: 0 };
}

export function AgentList({ agents, isLoading, isError, error, onRefetch, onAgentPress }: Props) {
  const insets = useSafeAreaInsets();
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const conversations = useChatStore((s) => s.conversations);

  const handleRefresh = React.useCallback(async () => {
    setIsRefreshing(true);
    try {
      onRefetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefetch]);

  const projects = React.useMemo<ProjectItem[]>(
    () =>
      agents.map((agent) => {
        const related = conversations.filter(
          (conv) => conv.agent_id === agent.id && conv.endpoint_id === agent.endpoint_id,
        );
        return { agent, status: projectStatus(related) };
      }),
    [agents, conversations],
  );

  const filteredProjects = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(({ agent }) => {
      return (
        agent.name.toLowerCase().includes(needle) ||
        agent.project_path.toLowerCase().includes(needle) ||
        agent.runtime.toLowerCase().includes(needle)
      );
    });
  }, [projects, query]);

  const activeProjects = React.useMemo(
    () => filteredProjects.filter((project) => project.status.isActive),
    [filteredProjects],
  );
  const allProjects = filteredProjects;

  const renderProject = (
    project: ProjectItem,
    index: number,
    hasDivider: boolean,
    metaVariant: 'status' | 'machine',
  ) => (
    <View key={project.agent.id} style={s.projectItem}>
      <AgentCard
        agent={project.agent}
        index={index}
        statusLabel={project.status.label}
        isActive={project.status.isActive}
        pendingCount={project.status.pendingCount}
        metaVariant={metaVariant}
        onPress={() =>
          onAgentPress(project.agent.id, project.agent.endpoint_id, project.agent.name)
        }
      />
      {hasDivider ? <View style={s.rowDivider} /> : null}
    </View>
  );

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Projects</Text>
        </View>
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#FF6B35" />
          <Text style={s.loadingText}>Loading projects...</Text>
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Projects</Text>
        </View>
        <View style={s.centered}>
          <View style={s.errorIconWrap}>
            <AlertCircle size={36} color="#FF4444" />
          </View>
          <Text style={s.errorTitle}>Failed to load</Text>
          <Text style={s.errorDesc}>{String(error)}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={onRefetch}>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View testID="projects-root" style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Projects</Text>
        <Plus size={24} color="#FF6B35" />
      </View>

      <View style={s.searchSection}>
        <View testID="projects-search-box" style={s.searchBox}>
          <Search size={14} color="#666666" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search projects"
            placeholderTextColor="#666666"
            style={s.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={filteredProjects.length === 0 ? s.emptyContainer : s.content}
        scrollEnabled={filteredProjects.length > 0}
        bounces={filteredProjects.length > 0}
        alwaysBounceVertical={filteredProjects.length > 0}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void handleRefresh();
            }}
            tintColor="#FF6B35"
            colors={['#FF6B35']}
          />
        }
      >
        {filteredProjects.length === 0 ? (
          <View style={s.emptyWrap}>
            {agents.length === 0 ? (
              <>
                <Text style={s.emptyTitle}>Connect a machine</Text>
                <Text style={s.emptyDesc}>
                  Add a machine by scanning its QR code or pasting a connection string.
                </Text>
              </>
            ) : (
              <>
                <Text style={s.emptyTitle}>No projects found</Text>
                <Text style={s.emptyDesc}>Try a different project name, path, or runtime.</Text>
              </>
            )}
          </View>
        ) : (
          <>
            {activeProjects.length > 0 ? (
              <>
                <Text style={s.sectionTitle}>Active Now</Text>
                {activeProjects.map((project, index) => (
                  <View key={project.agent.id} style={s.activeRow}>
                    {renderProject(project, index, false, 'status')}
                  </View>
                ))}
              </>
            ) : null}
            <Text style={s.sectionTitle}>All Projects</Text>
            <View testID="projects-group" style={s.projectGroup}>
              {allProjects.length === 0 ? (
                <Text style={s.emptyGroupText}>No idle projects.</Text>
              ) : (
                allProjects.map((project, index) =>
                  renderProject(project, index, index < allProjects.length - 1, 'machine'),
                )
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    height: 52,
    backgroundColor: '#0D0D0D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  headerTitle: { fontFamily: 'Inter', fontSize: 34, fontWeight: '700', color: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  loadingText: { fontFamily: 'Inter', fontSize: 13, color: '#888888' },
  errorIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: { fontFamily: 'Inter', fontSize: 22, fontWeight: '700', color: '#FF4444' },
  errorDesc: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: '#888888',
    textAlign: 'center',
    maxWidth: 260,
  },
  retryBtn: {
    height: 44,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: '#FF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  searchSection: {
    height: 52,
    paddingHorizontal: 16,
    justifyContent: 'center',
    backgroundColor: '#0D0D0D',
  },
  searchBox: {
    height: 36,
    borderRadius: 10,
    backgroundColor: '#1A1A1A',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  searchInput: { flex: 1, fontFamily: 'Inter', fontSize: 14, color: '#FFFFFF', padding: 0 },
  content: { paddingBottom: 110 },
  sectionTitle: {
    height: 38,
    paddingHorizontal: 20,
    paddingTop: 7,
    fontFamily: 'Inter',
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  activeRow: {
    marginHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#0D1A0D',
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
    overflow: 'hidden',
  },
  projectGroup: {
    marginHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
    overflow: 'hidden',
  },
  projectItem: { width: '100%' },
  rowDivider: { height: 1, backgroundColor: '#1E1E1E', marginLeft: 64 },
  emptyContainer: { flexGrow: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyTitle: { fontFamily: 'Inter', fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  emptyDesc: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: '#888888',
    textAlign: 'center',
    maxWidth: 260,
  },
  emptyGroupText: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: '#888888',
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
});
