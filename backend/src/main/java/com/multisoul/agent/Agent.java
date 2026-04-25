package com.multisoul.agent;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "agents")
public class Agent {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(nullable = false)
    private String endpoint;

    @Column(name = "auth_type", nullable = false)
    private String authType = "none";

    @Column(name = "auth_value", columnDefinition = "TEXT")
    private String authValue;

    @Column(nullable = false)
    private String status = "active";

    @Column(name = "owner_id", nullable = false)
    private UUID ownerId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected Agent() {}

    public Agent(String name, String description, String endpoint,
                 String authType, String authValue, UUID ownerId) {
        this.name = name;
        this.description = description;
        this.endpoint = endpoint;
        this.authType = authType;
        this.authValue = authValue;
        this.ownerId = ownerId;
    }

    @PreUpdate
    void onUpdate() { this.updatedAt = Instant.now(); }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public String getDescription() { return description; }
    public String getEndpoint() { return endpoint; }
    public String getAuthType() { return authType; }
    public String getAuthValue() { return authValue; }
    public String getStatus() { return status; }
    public UUID getOwnerId() { return ownerId; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }

    public void setName(String name) { this.name = name; }
    public void setDescription(String description) { this.description = description; }
    public void setEndpoint(String endpoint) { this.endpoint = endpoint; }
    public void setAuthType(String authType) { this.authType = authType; }
    public void setAuthValue(String authValue) { this.authValue = authValue; }
    public void setStatus(String status) { this.status = status; }
}
