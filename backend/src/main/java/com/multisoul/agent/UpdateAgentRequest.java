package com.multisoul.agent;

public record UpdateAgentRequest(
    String name,
    String description,
    String endpoint,
    String authType,
    String authValue,
    String status
) {}
