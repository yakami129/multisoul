package com.multisoul.user;

import com.multisoul.BaseIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/// UserControllerTest: verifies POST /api/v1/users creates a user and returns 201,
/// and that duplicate email returns 409.
///
/// Execution:
///   1. POST /api/v1/users with { "email": "test@example.com" }
///      → 201 Created, body has "id" (UUID) and "email"
///   2. POST /api/v1/users with same email again
///      → 409 Conflict, body has "code": "CONFLICT"
///
/// Expected:
///   - First request: HTTP 201, JSON has "id" and "email" = "test@example.com"
///   - Second request: HTTP 409, JSON has "code" = "CONFLICT"
class UserControllerTest extends BaseIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void createUserReturns201WithIdAndEmail() throws Exception {
        mockMvc.perform(post("/api/v1/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\": \"test@example.com\"}"))
               .andExpect(status().isCreated())
               .andExpect(jsonPath("$.id").isNotEmpty())
               .andExpect(jsonPath("$.email").value("test@example.com"));
    }

    @Test
    void duplicateEmailReturns409() throws Exception {
        String body = "{\"email\": \"dup@example.com\"}";

        mockMvc.perform(post("/api/v1/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
               .andExpect(status().isCreated());

        mockMvc.perform(post("/api/v1/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
               .andExpect(status().isConflict())
               .andExpect(jsonPath("$.code").value("CONFLICT"));
    }
}
