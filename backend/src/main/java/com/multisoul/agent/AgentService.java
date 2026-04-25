package com.multisoul.agent;

import com.multisoul.common.AesGcmEncryptor;
import com.multisoul.common.AppException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class AgentService {

    private final AgentRepository agentRepository;
    private final AesGcmEncryptor encryptor;

    public AgentService(AgentRepository agentRepository, AesGcmEncryptor encryptor) {
        this.agentRepository = agentRepository;
        this.encryptor = encryptor;
    }

    @Transactional
    public Agent createAgent(CreateAgentRequest request, UUID ownerId) {
        String encryptedAuthValue = encryptIfPresent(request.authValue());
        Agent agent = new Agent(
            request.name(),
            request.description(),
            request.endpoint(),
            request.authType(),
            encryptedAuthValue,
            ownerId
        );
        return agentRepository.save(agent);
    }

    @Transactional(readOnly = true)
    public List<Agent> listAgents(UUID ownerId) {
        return agentRepository.findByOwnerId(ownerId);
    }

    @Transactional(readOnly = true)
    public Agent getAgent(UUID agentId, UUID ownerId) {
        return agentRepository.findByIdAndOwnerId(agentId, ownerId)
            .orElseThrow(() -> AppException.notFound("Agent not found: " + agentId));
    }

    @Transactional
    public Agent updateAgent(UUID agentId, UpdateAgentRequest request, UUID ownerId) {
        Agent agent = getAgent(agentId, ownerId);
        if (request.name() != null) agent.setName(request.name());
        if (request.description() != null) agent.setDescription(request.description());
        if (request.endpoint() != null) agent.setEndpoint(request.endpoint());
        if (request.authType() != null) agent.setAuthType(request.authType());
        if (request.authValue() != null) agent.setAuthValue(encryptIfPresent(request.authValue()));
        if (request.status() != null) agent.setStatus(request.status());
        return agentRepository.save(agent);
    }

    @Transactional
    public void deleteAgent(UUID agentId, UUID ownerId) {
        Agent agent = getAgent(agentId, ownerId);
        agentRepository.delete(agent);
    }

    /**
     * Decrypts the agent's auth_value for internal use (e.g., forwarding requests).
     * Never expose the decrypted value in API responses.
     */
    public String decryptAuthValue(Agent agent) {
        if (agent.getAuthValue() == null || agent.getAuthValue().isBlank()) {
            return null;
        }
        return encryptor.decrypt(agent.getAuthValue());
    }

    private String encryptIfPresent(String value) {
        if (value == null || value.isBlank()) return null;
        return encryptor.encrypt(value);
    }
}
