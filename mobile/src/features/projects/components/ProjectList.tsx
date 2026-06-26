import { AlertCircle, Filter, Plus, Play, Search, Sparkles } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTelemetryTimer } from '@/services/telemetry';
import { brandAssets, brandColors } from '@/theme/brandRefresh';
import { type Project } from '../types';
import { ProjectCard } from './ProjectCard';
import { ProjectEndpointFilterSheet } from './ProjectEndpointFilterSheet';
import { s } from './ProjectList.styles';
import { QuickWorkflowCard, SectionTitle, StatCell } from './ProjectListParts';
import {
  endpointName,
  getProjectEndpointFilterOptions,
  projectStatus,
  sortProjects,
} from './projectUi';

interface Props {
  projects: Project[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  onRefetch: () => void;
  onProjectPress: (id: string, endpoint_id: string) => void;
  onAddEndpoint?: () => void;
  onOpenWorkflows?: () => void;
}

function statusLabelKey(project: Project) {
  const status = projectStatus(project);
  if (status.kind === 'awaiting_question') return 'projects.statusAwaiting';
  if (status.kind === 'running') return 'projects.statusRunning';
  if (status.kind === 'failed') return 'projects.statusFailed';
  if (status.kind === 'completed') return 'projects.statusCompleted';
  return 'projects.statusIdle';
}

export function ProjectList({
  projects,
  isLoading,
  isError,
  error,
  onRefetch,
  onProjectPress,
  onAddEndpoint,
  onOpenWorkflows,
}: Props) {
  useTelemetryTimer('projects');
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const searchRef = React.useRef<TextInput>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [selectedEndpointId, setSelectedEndpointId] = React.useState('all');
  const [isFilterSheetVisible, setIsFilterSheetVisible] = React.useState(false);

  const sortedProjects = React.useMemo(() => sortProjects(projects), [projects]);
  const filterOptions = React.useMemo(() => getProjectEndpointFilterOptions(projects), [projects]);
  const selectedEndpoint = filterOptions.find((option) => option.id === selectedEndpointId);
  const hasEndpointFilter = selectedEndpointId !== 'all';

  React.useEffect(() => {
    if (!filterOptions.some((option) => option.id === selectedEndpointId)) {
      setSelectedEndpointId('all');
    }
  }, [filterOptions, selectedEndpointId]);

  const filteredProjects = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortedProjects.filter((project) => {
      if (hasEndpointFilter && project.endpoint_id !== selectedEndpointId) return false;
      if (!needle) return true;
      return (
        project.name.toLowerCase().includes(needle) ||
        project.project_path.toLowerCase().includes(needle) ||
        project.endpoint_label.toLowerCase().includes(needle)
      );
    });
  }, [hasEndpointFilter, query, selectedEndpointId, sortedProjects]);

  const stats = React.useMemo(
    () =>
      projects.reduce(
        (sum, project) => ({
          running: sum.running + project.session_counts.running,
          needsYou: sum.needsYou + project.session_counts.awaiting_question,
          done: sum.done + project.session_counts.completed,
        }),
        { running: 0, needsYou: 0, done: 0 },
      ),
    [projects],
  );

  const handleRefresh = React.useCallback(async () => {
    setIsRefreshing(true);
    try {
      onRefetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefetch]);

  const selectEndpointFilter = React.useCallback((endpointId: string) => {
    setSelectedEndpointId(endpointId);
    setIsFilterSheetVisible(false);
  }, []);

  const renderContent = () => {
    if (isLoading) {
      return (
        <>
          <SectionTitle title={t('projects.fleetTitle')} />
          <View testID="projects-group" style={s.loadingCard}>
            <ActivityIndicator size="small" color={brandColors.cyan} />
            <Text style={s.loadingText}>{t('projects.loadingProjects')}</Text>
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
          {projects.length === 0 ? (
            <>
              <Text style={s.emptyTitle}>{t('projects.connectMachine')}</Text>
              <Text style={s.emptyDesc}>{t('projects.connectMachineDesc')}</Text>
              <TouchableOpacity
                accessibilityLabel="Scan QR Code to connect machine"
                accessibilityRole="button"
                onPress={onAddEndpoint}
                style={s.emptyBtn}
              >
                <Text style={s.emptyBtnText}>{t('projects.connectMachineCta')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.emptyTitle}>{t('projects.noProjectsFound')}</Text>
              <Text style={s.emptyDesc}>{t('projects.noProjectsFoundDesc')}</Text>
            </>
          )}
        </View>
      );
    }

    return (
      <>
        <SectionTitle title={t('projects.fleetTitle')} />
        <View testID="projects-group" style={s.projectGroup}>
          {filteredProjects.map((project, index) => (
            <ProjectCard
              key={`${project.endpoint_id}:${project.id}`}
              project={project}
              index={index}
              statusLabel={t(statusLabelKey(project))}
              onPress={() => onProjectPress(project.id, project.endpoint_id)}
            />
          ))}
        </View>
      </>
    );
  };

  if (isError) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Text style={s.pageTitle}>{t('projects.title')}</Text>
        <View style={s.centered}>
          <View style={s.errorIconWrap}>
            <AlertCircle size={36} color={brandColors.error} />
          </View>
          <Text style={s.errorTitle}>{t('projects.failedToLoad')}</Text>
          <Text style={s.errorDesc}>{String(error)}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={onRefetch}>
            <Text style={s.retryText}>{t('common.retry')}</Text>
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
              accessibilityLabel="Focus project search"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => searchRef.current?.focus()}
              style={s.roundButton}
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

        <View testID="projects-hero-card" style={s.heroCard}>
          <View style={s.heroOrbit} />
          <View style={s.heroSparkle}>
            <Sparkles size={15} color={brandColors.white} />
          </View>
          <View style={s.heroCopy}>
            <Text style={s.heroTitle}>{t('projects.heroTitle')}</Text>
            <Text style={s.heroText}>{t('projects.heroText')}</Text>
            <View style={s.connectionChip}>
              <View style={s.connectionDot} />
              <Text style={s.connectionText} numberOfLines={1} ellipsizeMode="tail">
                {t('projects.connectedTo', {
                  name: endpointName(projects, t('projects.yourMachine')),
                })}
              </Text>
            </View>
          </View>
          <Image
            source={brandAssets.mascotPhoneStandingHero}
            style={s.heroMascot}
            resizeMode="contain"
          />
          <View style={s.statsCard}>
            <StatCell
              value={stats.running}
              label={t('projects.statsRunning')}
              color={brandColors.cyan}
              icon={<Play size={11} color={brandColors.white} fill={brandColors.white} />}
            />
            <StatCell
              bordered
              value={stats.needsYou}
              label={t('projects.statsNeedsYou')}
              color={brandColors.coral}
              icon={<Text style={s.statBang}>!</Text>}
            />
            <StatCell
              bordered
              value={stats.done}
              label={t('projects.statsDone')}
              color={brandColors.lime}
              icon={<Text style={s.statCheck}>✓</Text>}
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
              placeholder={t('projects.searchPlaceholder')}
              placeholderTextColor={brandColors.textSoft}
              style={s.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <TouchableOpacity
            accessibilityLabel="Filter projects by endpoint"
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
              {selectedEndpoint.count === 1 ? t('projects.project') : t('projects.projects')}
            </Text>
            <TouchableOpacity
              accessibilityLabel="Clear endpoint filter"
              accessibilityRole="button"
              onPress={() => setSelectedEndpointId('all')}
              style={s.filterClearButton}
            >
              <Text style={s.filterClearText}>{t('projects.clearFilter')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {renderContent()}

        <SectionTitle title={t('projects.quickWorkflows')} />
        <View style={s.workflowGrid}>
          <QuickWorkflowCard
            title={t('projects.dailyStandup')}
            subtitle={t('projects.dailyStandupSubtitle')}
            image={brandAssets.mascotLaptopWorking}
            onPress={onOpenWorkflows}
          />
          <QuickWorkflowCard
            title={t('projects.connectMachineWorkflow')}
            subtitle={t('projects.connectMachineWorkflowSubtitle')}
            image={brandAssets.mascotPhoneStanding}
            onPress={onAddEndpoint}
          />
        </View>
      </ScrollView>
      <ProjectEndpointFilterSheet
        visible={isFilterSheetVisible}
        options={filterOptions}
        selectedEndpointId={selectedEndpointId}
        onSelect={selectEndpointFilter}
        onClose={() => setIsFilterSheetVisible(false)}
      />
    </View>
  );
}
