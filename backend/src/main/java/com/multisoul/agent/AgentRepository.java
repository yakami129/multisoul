package com.multisoul.agent;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AgentRepository extends JpaRepository<Agent, UUID> {
    List<Agent> findByOwnerId(UUID ownerId);
    Optional<Agent> findByIdAndOwnerId(UUID id, UUID ownerId);
}
