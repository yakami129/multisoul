import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { buildChatDetailPath } from '../../../src/features/chat/utils/chatRoutes';
import {
  ProjectDetail,
  createProjectConversation,
  fetchProject,
  fetchProjectResources,
  fetchProjectSessions,
  type Project,
  type ProjectResource,
  type ProjectSession,
} from '../../../src/features/projects';
import { useChatStore } from '../../../src/store/chatStore';
import { useEndpointStore } from '../../../src/store/endpointStore';

function attachResourceNames(
  sessions: ProjectSession[],
  resources: ProjectResource[],
): ProjectSession[] {
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
  return sessions.map((session) => ({
    ...session,
    agent_name: resourceById.get(session.agent_id)?.name ?? session.agent_name ?? session.agent_id,
  }));
}

export default function ProjectDetailScreen() {
  const { id, endpoint_id } = useLocalSearchParams<{ id: string; endpoint_id: string }>();
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const mergeConversations = useChatStore((s) => s.mergeConversations);
  const addConversation = useChatStore((s) => s.addConversation);

  const [project, setProject] = useState<Project | undefined>(undefined);
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [resources, setResources] = useState<ProjectResource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const hydratedSurfaceRef = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!id) {
        hydratedSurfaceRef.current = null;
        setIsLoading(false);
        setIsError(true);
        setProject(undefined);
        setSessions([]);
        setResources([]);
        return;
      }

      const endpoint = endpoint_id ? endpoints.find((ep) => ep.id === endpoint_id) : endpoints[0];
      if (!endpoint) {
        hydratedSurfaceRef.current = null;
        setIsLoading(false);
        setIsError(true);
        setProject(undefined);
        setSessions([]);
        setResources([]);
        return;
      }

      const surfaceKey = `${id}:${endpoint.id}`;
      const softRefresh =
        hydratedSurfaceRef.current !== null && hydratedSurfaceRef.current === surfaceKey;
      if (!softRefresh) {
        setIsLoading(true);
        setIsError(false);
        setProject(undefined);
        setSessions([]);
        setResources([]);
      } else {
        setIsError(false);
      }

      let cancelled = false;

      Promise.all([
        fetchProject(endpoint.base_url, endpoint.token, id, endpoint.id, endpoint.label),
        fetchProjectSessions(endpoint.base_url, endpoint.token, id, endpoint.id),
        fetchProjectResources(endpoint.base_url, endpoint.token, id, endpoint.id, endpoint.label),
      ])
        .then(([nextProject, nextSessions, nextResources]) => {
          if (cancelled) return;
          const hydratedSessions = attachResourceNames(nextSessions, nextResources);
          hydratedSurfaceRef.current = surfaceKey;
          setProject(nextProject);
          setSessions(hydratedSessions);
          setResources(nextResources);
          mergeConversations(hydratedSessions);
          setIsLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          if (!softRefresh) setIsError(true);
          setIsLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [id, endpoint_id, endpoints, mergeConversations]),
  );

  const openSession = (session: ProjectSession, resource?: ProjectResource) => {
    router.push(
      buildChatDetailPath({
        conversationId: session.id,
        endpointId: session.endpoint_id,
        agentId: session.agent_id,
        agentName: resource?.name ?? session.agent_name,
        projectId: session.project_id ?? project?.id,
      }),
    );
  };

  const handleNewSession = async () => {
    if (!project) return;
    const endpoint = endpoints.find((ep) => ep.id === project.endpoint_id);
    if (!endpoint) return;
    const defaultResource =
      resources.find((resource) => resource.id === project.default_resource_id) ?? resources[0];
    const session = await createProjectConversation(
      endpoint.base_url,
      endpoint.token,
      project.id,
      endpoint.id,
      defaultResource?.name ?? '',
      'New Session',
      defaultResource?.id,
    );
    const hydratedSession = {
      ...session,
      agent_name: defaultResource?.name ?? session.agent_name ?? session.agent_id,
    };
    addConversation(hydratedSession);
    setSessions((current) => [hydratedSession, ...current]);
    openSession(hydratedSession, defaultResource);
  };

  return (
    <ProjectDetail
      project={project}
      sessions={sessions}
      resources={resources}
      isLoading={isLoading}
      isError={isError}
      onBack={() => router.back()}
      onNewSession={() => {
        void handleNewSession();
      }}
      onOpenSession={openSession}
      onOpenResource={(resource) => {
        router.push(
          `/agent/${encodeURIComponent(resource.id)}?endpoint_id=${encodeURIComponent(
            resource.endpoint_id,
          )}`,
        );
      }}
    />
  );
}
