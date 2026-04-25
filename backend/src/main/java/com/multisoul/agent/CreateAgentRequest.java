package com.multisoul.agent;

public record CreateAgentRequest(
    String name,
    String description,
    String endpoint,
    String authType,
    String authValue
) {}
