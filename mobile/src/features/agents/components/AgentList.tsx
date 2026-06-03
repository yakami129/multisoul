import {
  AlertCircle,
  ChevronRight,
  Filter,
  Plus,
  Play,
  Search,
  Sparkles,
} from 'lucide-react-native';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChatStore } from '@/store/chatStore';
import { brandAssets, brandColors } from '@/theme/brandRefresh';
import { type Agent, type Conversation } from '@/types';
import { AgentCard } from './AgentCard';
import { s } from './AgentList.styles';

interface Props {
  agents: Agent[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  onRefetch: () => void;
  onAgentPress: (id: string, endpoint_id: string, name: string) => void;
  onAddEndpoint?: () => void;
  onOpenWorkflows?: () => void;
}

type ProjectStatus = {
  label: string;
  kind: 'idle' | 'running' | 'awaiting_question' | 'failed';
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
    return {
      label: 'Running · Awaiting answer',
      kind: 'awaiting_question',
      isActive: true,
      pendingCount,
    };
  }
  if (conversations.some((conv) => conv.status === 'running')) {
    return { label: 'Running', kind: 'running', isActive: true, pendingCount: 0 };
  }
  if (conversations.some((conv) => conv.status === 'failed')) {
    return { label: 'Failed', kind: 'failed', isActive: false, pendingCount: 0 };
  }
  return { label: 'Idle', kind: 'idle', isActive: false, pendingCount: 0 };
}

function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

function StatCell({
  value,
  label,
  color,
  icon,
  bordered,
}: {
  value: number;
  label: string;
  color: string;
  icon: React.ReactNode;
  bordered?: boolean;
}) {
  return (
    <View style={[s.statCell, bordered && s.statCellBorder]}>
      <View style={[s.statIcon, { backgroundColor: color }]}>{icon}</View>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function QuickWorkflowCard({
  title,
  subtitle,
  image,
  onPress,
}: {
  title: string;
  subtitle: string;
  image: ImageSourcePropType;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={s.workflowCard}
    >
      <Image source={image} style={s.workflowImage} resizeMode="contain" />
      <View style={s.workflowCopy}>
        <Text style={s.workflowTitle}>{title}</Text>
        <Text style={s.workflowSubtitle}>{subtitle}</Text>
      </View>
      <View style={s.workflowArrow}>
        <ChevronRight size={20} color={brandColors.ink} />
      </View>
    </TouchableOpacity>
  );
}

function endpointName(agents: Agent[]) {
  const first = agents.find((agent) => agent.endpoint_label.trim().length > 0);
  return first?.endpoint_label ?? 'your machine';
}

export function AgentList({
  agents,
  isLoading,
  isError,
  error,
  onRefetch,
  onAgentPress,
  onAddEndpoint,
  onOpenWorkflows,
}: Props) {
  const insets = useSafeAreaInsets();
  const searchRef = React.useRef<TextInput>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const conversations = useChatStore((state) => state.conversations);

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

  const stats = React.useMemo(() => {
    const running = projects.filter((project) => project.status.kind === 'running').length;
    const needsYou = projects.reduce((sum, project) => sum + project.status.pendingCount, 0);
    const done = conversations.filter((conv) => conv.status === 'completed').length;
    return { running, needsYou, done };
  }, [conversations, projects]);

  const renderContent = () => {
    if (filteredProjects.length === 0) {
      return (
        <View style={s.emptyWrap}>
          <Image
            source={brandAssets.mascotLaptopWorking}
            style={s.emptyImage}
            resizeMode="contain"
          />
          {agents.length === 0 ? (
            <>
              <Text style={s.emptyTitle}>Connect a machine</Text>
              <Text style={s.emptyDesc}>
                Add a machine by scanning its QR code or pasting a connection string.
              </Text>
            </>
          ) : (
            <>
              <Text style={s.emptyTitle}>No agents found</Text>
              <Text style={s.emptyDesc}>Try a different agent name, path, or runtime.</Text>
            </>
          )}
        </View>
      );
    }

    return (
      <>
        <SectionTitle
          title="Agent Fleet"
          action={
            <View style={s.viewAll}>
              <Text style={s.viewAllText}>View All</Text>
              <ChevronRight size={18} color={brandColors.textSoft} />
            </View>
          }
        />
        <View testID="projects-group" style={s.projectGroup}>
          {filteredProjects.map((project, index) => (
            <View key={project.agent.id} style={s.projectItem}>
              <AgentCard
                agent={project.agent}
                index={index}
                statusLabel={project.status.label}
                isActive={project.status.isActive}
                pendingCount={project.status.pendingCount}
                metaVariant="machine"
                showBreathingEffect={project.status.kind === 'running'}
                onPress={() =>
                  onAgentPress(project.agent.id, project.agent.endpoint_id, project.agent.name)
                }
              />
              {index < filteredProjects.length - 1 ? <View style={s.rowDivider} /> : null}
            </View>
          ))}
        </View>
      </>
    );
  };

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Text style={s.pageTitle}>Agents</Text>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={brandColors.cyan} />
          <Text style={s.loadingText}>Loading agents...</Text>
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Text style={s.pageTitle}>Agents</Text>
        <View style={s.centered}>
          <View style={s.errorIconWrap}>
            <AlertCircle size={36} color={brandColors.error} />
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
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void handleRefresh();
            }}
            tintColor={brandColors.cyan}
            colors={[brandColors.cyan]}
          />
        }
      >
        <View style={s.header}>
          <View style={s.brandBlock}>
            <Image
              source={brandAssets.mascotAppIconBadge}
              style={s.brandMascot}
              resizeMode="contain"
            />
            <View style={s.brandCopy}>
              <Text style={s.brandName} numberOfLines={1}>
                MultiSoul
              </Text>
              <Text style={s.pageTitle} numberOfLines={1}>
                Agents
              </Text>
            </View>
          </View>
          <View style={s.headerActions}>
            <TouchableOpacity
              accessibilityLabel="Focus agent search"
              accessibilityRole="button"
              style={s.roundButton}
              onPress={() => searchRef.current?.focus()}
            >
              <Search size={28} color={brandColors.ink} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel="Add endpoint"
              accessibilityRole="button"
              hitSlop={12}
              onPress={onAddEndpoint}
              style={s.roundButton}
            >
              <Plus size={30} color={brandColors.ink} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.heroCard}>
          <View style={s.heroCopy}>
            <Text style={s.heroTitle}>Your agents{'\n'}in your hand</Text>
            <Text style={s.heroText}>
              Remote control for your local AI agents. Focus on what matters.
            </Text>
            <View style={s.connectionChip}>
              <View style={s.connectionDot} />
              <Text style={s.connectionText}>Connected to {endpointName(agents)}</Text>
            </View>
          </View>
          <Image
            source={brandAssets.mascotPhoneStanding}
            style={s.heroMascot}
            resizeMode="contain"
          />
          <View style={s.statsCard}>
            <StatCell
              value={stats.running}
              label="Running"
              color={brandColors.cyan}
              icon={<Play size={18} color={brandColors.white} fill={brandColors.white} />}
            />
            <StatCell
              value={stats.needsYou}
              label="Needs You"
              color={brandColors.coral}
              icon={<Text style={s.statBang}>!</Text>}
              bordered
            />
            <StatCell
              value={stats.done}
              label="Done"
              color={brandColors.lime}
              icon={<Text style={s.statCheck}>✓</Text>}
              bordered
            />
          </View>
        </View>

        <View style={s.searchSection}>
          <View testID="projects-search-box" style={s.searchBox}>
            <Search size={24} color={brandColors.textSoft} />
            <TextInput
              ref={searchRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search agents..."
              placeholderTextColor={brandColors.textSoft}
              style={s.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={s.filterButton} accessibilityElementsHidden>
            <Filter size={24} color={brandColors.ink} />
          </View>
        </View>

        {renderContent()}

        <SectionTitle title="Quick Workflows" />
        <View style={s.workflowGrid}>
          <QuickWorkflowCard
            title="Daily Standup"
            subtitle="Get updates from all agents and tasks."
            image={brandAssets.mascotLaptopWorking}
            onPress={onOpenWorkflows}
          />
          <QuickWorkflowCard
            title="Connect Machine"
            subtitle="Add a new machine and start commanding."
            image={brandAssets.mascotPhoneStanding}
            onPress={onAddEndpoint}
          />
        </View>
      </ScrollView>
    </View>
  );
}
