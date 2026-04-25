package com.multisoul.user;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected User() {}

    public User(String email) {
        this.email = email;
    }

    public UUID getId() { return id; }
    public String getEmail() { return email; }
    public Instant getCreatedAt() { return createdAt; }
}
