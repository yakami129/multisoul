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
import { useTranslation } from 'react-i18next';
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
import { AgentEndpointFilterSheet } from './AgentEndpointFilterSheet';
import { s } from './AgentList.styles';
import { getEndpointFilterOptions } from '../utils/endpointFilterUtils';

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

type ProjectStatusLabel =
  | 'agents.statusAwaiting'
  | 'agents.statusRunning'
  | 'agents.statusFailed'
  | 'agents.statusIdle';

type ProjectStatus = {
  label: ProjectStatusLabel;
  kind: 'idle' | 'running' | 'awaiting_question' | 'failed';
  isActive: boolean;
  pendingCount: number;
};

type ProjectItem = {
  agent: Agent;
  status: ProjectStatus;
};

const PROJECT_STATUS_RANK: Record<ProjectStatus['kind'], number> = {
  awaiting_question: 0,
  running: 1,
  failed: 2,
  idle: 3,
};

function projectStatus(conversations: Conversation[]): ProjectStatus {
  const pendingCount = conversations.filter((conv) => conv.status === 'awaiting_question').length;
  if (pendingCount > 0) {
    return {
      label: 'agents.statusAwaiting',
      kind: 'awaiting_question',
      isActive: true,
      pendingCount,
    };
  }
  if (conversations.some((conv) => conv.status === 'running')) {
    return { label: 'agents.statusRunning', kind: 'running', isActive: true, pendingCount: 0 };
  }
  // Only show Failed if the most recent conversation is failed; historical failures don't
  // affect fleet status once newer conversations exist.
  const mostRecent = [...conversations].sort((a, b) => b.last_message_at - a.last_message_at)[0];
  if (mostRecent?.status === 'failed') {
    return { label: 'agents.statusFailed', kind: 'failed', isActive: false, pendingCount: 0 };
  }
  return { label: 'agents.statusIdle', kind: 'idle', isActive: false, pendingCount: 0 };
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
        <Text style={s.workflowTitle} numberOfLines={1} ellipsizeMode="tail">
          {title}
        </Text>
        <Text style={s.workflowSubtitle} numberOfLines={1} ellipsizeMode="tail">
          {subtitle}
        </Text>
      </View>
      <View style={s.workflowArrow}>
        <ChevronRight size={18} color={brandColors.ink} />
      </View>
    </TouchableOpacity>
  );
}

function endpointName(agents: Agent[], fallback: string) {
  const first = agents.find((agent) => agent.endpoint_label.trim().length > 0);
  return first?.endpoint_label ?? fallback;
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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const searchRef = React.useRef<TextInput>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [selectedEndpointId, setSelectedEndpointId] = React.useState('all');
  const [isFilterSheetVisible, setIsFilterSheetVisible] = React.useState(false);
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
  const sortedProjects = React.useMemo(
    () =>
      [...projects].sort(
        (left, right) =>
          PROJECT_STATUS_RANK[left.status.kind] - PROJECT_STATUS_RANK[right.status.kind],
      ),
    [projects],
  );

  const filterOptions = React.useMemo(() => getEndpointFilterOptions(agents), [agents]);
  const selectedEndpoint = filterOptions.find((option) => option.id === selectedEndpointId);
  const hasEndpointFilter = selectedEndpointId !== 'all';

  React.useEffect(() => {
    if (!filterOptions.some((option) => option.id === selectedEndpointId)) {
      setSelectedEndpointId('all');
    }
  }, [filterOptions, selectedEndpointId]);

  const filteredProjects = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortedProjects.filter(({ agent }) => {
      if (hasEndpointFilter && agent.endpoint_id !== selectedEndpointId) {
        return false;
      }
      if (!needle) return true;
      return (
        agent.name.toLowerCase().includes(needle) ||
        agent.project_path.toLowerCase().includes(needle) ||
        agent.runtime.toLowerCase().includes(needle) ||
        agent.endpoint_label.toLowerCase().includes(needle)
      );
    });
  }, [hasEndpointFilter, query, selectedEndpointId, sortedProjects]);

  const selectEndpointFilter = React.useCallback((endpointId: string) => {
    setSelectedEndpointId(endpointId);
    setIsFilterSheetVisible(false);
  }, []);

  const stats = React.useMemo(() => {
    const running = projects.filter((project) => project.status.kind === 'running').length;
    const needsYou = projects.reduce((sum, project) => sum + project.status.pendingCount, 0);
    const done = conversations.filter((conv) => conv.status === 'completed').length;
    return { running, needsYou, done };
  }, [conversations, projects]);

  const renderContent = () => {
    if (isLoading) {
      return (
        <>
          <SectionTitle title={t('agents.fleetTitle')} />
          <View testID="projects-group" style={s.fleetLoadingCard}>
            <ActivityIndicator size="small" color={brandColors.cyan} />
            <Text style={s.loadingText}>{t('agents.loadingAgents')}</Text>
          </View>
        </>
      );
    }

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
              <Text style={s.emptyTitle}>{t('agents.connectMachine')}</Text>
              <Text style={s.emptyDesc}>{t('agents.connectMachineDesc')}</Text>
            </>
          ) : (
            <>
              <Text style={s.emptyTitle}>{t('agents.noAgentsFound')}</Text>
              <Text style={s.emptyDesc}>{t('agents.noAgentsFoundDesc')}</Text>
            </>
          )}
        </View>
      );
    }

    return (
      <>
        <SectionTitle
          title={t('agents.fleetTitle')}
          action={
            <View style={s.viewAll}>
              <Text style={s.viewAllText}>{t('agents.viewAll')}</Text>
              <ChevronRight size={18} color={brandColors.textSoft} />
            </View>
          }
        />
        <View testID="projects-group" style={s.projectGroup}>
          {filteredProjects.map((project, index) => (
            <View key={project.agent.id}>
              <AgentCard
                agent={project.agent}
                index={index}
                statusLabel={t(project.status.label)}
                isActive={project.status.isActive}
                pendingCount={project.status.pendingCount}
                metaVariant="machine"
                showBreathingEffect={project.status.kind === 'running'}
                onPress={() =>
                  onAgentPress(project.agent.id, project.agent.endpoint_id, project.agent.name)
                }
              />
            </View>
          ))}
        </View>
      </>
    );
  };

  if (isError) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Text style={s.pageTitle}>{t('agents.title')}</Text>
        <View style={s.centered}>
          <View style={s.errorIconWrap}>
            <AlertCircle size={36} color={brandColors.error} />
          </View>
          <Text style={s.errorTitle}>{t('agents.failedToLoad')}</Text>
          <Text style={s.errorDesc}>{String(error)}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={onRefetch}>
            <Text style={s.retryText}>{t('agents.retry')}</Text>
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
            </View>
          </View>
          <View style={s.headerActions}>
            <TouchableOpacity
              accessibilityLabel="Focus agent search"
              accessibilityRole="button"
              hitSlop={10}
              style={s.roundButton}
              onPress={() => searchRef.current?.focus()}
            >
              <Search size={22} color={brandColors.ink} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel="Add endpoint"
              accessibilityRole="button"
              hitSlop={12}
              onPress={onAddEndpoint}
              style={s.roundButton}
            >
              <Plus size={24} color={brandColors.ink} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.heroCard}>
          <View style={s.heroOrbit} />
          <View style={s.heroSparkle}>
            <Sparkles size={15} color={brandColors.white} />
          </View>
          <View style={s.heroCopy}>
            <Text style={s.heroTitle}>{t('agents.heroTitle')}</Text>
            <Text style={s.heroText}>{t('agents.heroText')}</Text>
            <View style={s.connectionChip}>
              <View style={s.connectionDot} />
              <Text style={s.connectionText} numberOfLines={1} ellipsizeMode="tail">
                {t('agents.connectedTo', { name: endpointName(agents, t('agents.yourMachine')) })}
              </Text>
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
              label={t('agents.statsRunning')}
              color={brandColors.cyan}
              icon={<Play size={11} color={brandColors.white} fill={brandColors.white} />}
            />
            <StatCell
              value={stats.needsYou}
              label={t('agents.statsNeedsYou')}
              color={brandColors.coral}
              icon={<Text style={s.statBang}>!</Text>}
              bordered
            />
            <StatCell
              value={stats.done}
              label={t('agents.statsDone')}
              color={brandColors.lime}
              icon={<Text style={s.statCheck}>✓</Text>}
              bordered
            />
          </View>
        </View>

        <View style={s.searchSection}>
          <View testID="projects-search-box" style={s.searchBox}>
            <Search size={19} color={brandColors.textSoft} />
            <TextInput
              ref={searchRef}
              value={query}
              onChangeText={setQuery}
              placeholder={t('agents.searchPlaceholder')}
              placeholderTextColor={brandColors.textSoft}
              style={s.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <TouchableOpacity
            accessibilityLabel="Filter agents by endpoint"
            accessibilityRole="button"
            accessibilityState={{ selected: hasEndpointFilter }}
            hitSlop={10}
            onPress={() => setIsFilterSheetVisible(true)}
            style={[s.filterButton, hasEndpointFilter && s.filterButtonActive]}
          >
            <Filter size={19} color={brandColors.ink} />
            {hasEndpointFilter ? <View style={s.filterDot} /> : null}
          </TouchableOpacity>
        </View>
        {hasEndpointFilter && selectedEndpoint ? (
          <View style={s.filterSummary}>
            <Text style={s.filterSummaryText} numberOfLines={1} ellipsizeMode="tail">
              {selectedEndpoint.label} · {selectedEndpoint.count}{' '}
              {selectedEndpoint.count === 1 ? t('agents.agent') : t('agents.agents')}
            </Text>
            <TouchableOpacity
              accessibilityLabel="Clear endpoint filter"
              accessibilityRole="button"
              onPress={() => setSelectedEndpointId('all')}
              style={s.filterClearButton}
            >
              <Text style={s.filterClearText}>{t('agents.clearFilter')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {renderContent()}

        <SectionTitle title={t('agents.quickWorkflows')} />
        <View style={s.workflowGrid}>
          <QuickWorkflowCard
            title={t('agents.dailyStandup')}
            subtitle={t('agents.dailyStandupSubtitle')}
            image={brandAssets.mascotLaptopWorking}
            onPress={onOpenWorkflows}
          />
          <QuickWorkflowCard
            title={t('agents.connectMachineWorkflow')}
            subtitle={t('agents.connectMachineWorkflowSubtitle')}
            image={brandAssets.mascotPhoneStanding}
            onPress={onAddEndpoint}
          />
        </View>
      </ScrollView>
      <AgentEndpointFilterSheet
        visible={isFilterSheetVisible}
        options={filterOptions}
        selectedEndpointId={selectedEndpointId}
        onSelect={selectEndpointFilter}
        onClose={() => setIsFilterSheetVisible(false)}
      />
    </View>
  );
}
